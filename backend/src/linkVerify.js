import dns from 'node:dns';
import net from 'node:net';

// Link verification enrichment: runs ONCE per judge request, upstream of
// buildPrompt, so every provider (Groq/Gemini/Anthropic) sees the same
// server-fetched ground truth about any URL the staker put in their proof.
// Nothing in here is allowed to throw out of enrichProofContent — a fetch
// failure degrades into an explicit "could not be verified" note in the
// prompt instead of counting as a provider failure in FallbackJudge.

const MAX_LINKS = 3; // don't let a link-stuffed proof turn us into a crawler
const FETCH_TIMEOUT_MS = 6000;
const SNIPPET_CHARS = 2000;

const URL_REGEX = /https?:\/\/[^\s<>"'`)\]]+/gi;
// People often paste links without the scheme ("x.com", "github.com/user/repo").
// Requires a real-looking TLD so ordinary prose ("e.g.", "Node.js", "etc.") doesn't
// get mistaken for a link.
const BARE_DOMAIN_REGEX =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|dev|app|co|xyz|gg|sh|ai|so|me|link|page|site|tech|info|live)\b(?:\/[^\s<>"'`)\]]*)?/gi;

export function extractUrls(text) {
  const input = text || '';
  const raw = input.match(URL_REGEX) || [];
  const withScheme = [...new Set(raw.map((u) => u.replace(/[.,;:!?]+$/, '')))];

  const bare = input.match(BARE_DOMAIN_REGEX) || [];
  const normalized = bare
    .map((u) => u.replace(/[.,;:!?]+$/, ''))
    .filter((u) => !withScheme.some((full) => full.includes(u)))
    .map((u) => `https://${u}`);

  return [...new Set([...withScheme, ...normalized])].slice(0, MAX_LINKS);
}

// ---------- SSRF guard (best-effort: blocks the obvious internal targets) ----------

function isPrivateIPv4(ip) {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true; // fail closed
  if (o[0] === 127) return true; // loopback 127.0.0.0/8
  if (o[0] === 10) return true; // 10.0.0.0/8
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16.0.0/12
  if (o[0] === 192 && o[1] === 168) return true; // 192.168.0.0/16
  if (o[0] === 169 && o[1] === 254) return true; // link-local / cloud metadata
  if (o[0] === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb'))
    return true; // fe80::/10 link-local
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // v4-mapped v6
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

// Throws with a human-readable reason if the URL must not be fetched.
async function assertSafeUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('not a parseable URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`scheme "${url.protocol}" is not allowed (only http/https)`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
    throw new Error('refusing to fetch localhost');
  }
  // Literal IP in the URL — check it directly, no DNS needed.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`refusing to fetch private/internal address ${hostname}`);
    }
    return url;
  }
  let address;
  try {
    ({ address } = await dns.promises.lookup(hostname));
  } catch {
    throw new Error(`hostname "${hostname}" did not resolve`);
  }
  if (isPrivateIp(address)) {
    throw new Error(`hostname "${hostname}" resolves to private/internal address ${address}`);
  }
  return url;
}

// ---------- fetching ----------

async function fetchOnce(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': 'vow-commitment-judge', ...(options.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

// One retry on timeout: cold TLS/connection setup on this box has been seen
// pushing a first request past 6s while the retry lands in ~1s. Anything
// else (DNS failures, HTTP errors) surfaces immediately without retrying.
async function fetchWithTimeout(url, options = {}) {
  try {
    return await fetchOnce(url, options);
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
    return await fetchOnce(url, options);
  }
}

function parseGitHubRepo(url) {
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}

// Real repo metadata straight from the GitHub REST API (unauthenticated).
async function describeGitHubRepo({ owner, repo }, originalUrl) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetchWithTimeout(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });

  if (res.status === 404) {
    // Concrete, important signal — not a soft failure. The staker linked a
    // repo that does not exist (or is private and thus unverifiable).
    return (
      `[${originalUrl}]: GITHUB REPO NOT FOUND. The GitHub API returned 404 for ` +
      `${owner}/${repo} — this repository does not exist publicly (it may never have existed, ` +
      `may have been deleted, or is private). The staker's linked evidence could NOT be found. ` +
      `Treat this as a strong reason for skepticism.`
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}`);
  }

  const data = await res.json();
  const looksEmpty = data.size === 0;

  // Latest commit for a real recency signal (empty repos return 409 here).
  let commitLine = 'Latest commit: (could not be fetched)';
  try {
    const cRes = await fetchWithTimeout(`${apiUrl}/commits?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (cRes.status === 409) {
      commitLine = 'Latest commit: none — the repository has no commits (empty repo).';
    } else if (cRes.ok) {
      const commits = await cRes.json();
      if (Array.isArray(commits) && commits.length > 0) {
        const c = commits[0];
        const msg = (c.commit?.message || '').split('\n')[0].slice(0, 200);
        const author = c.commit?.author?.name || 'unknown';
        const date = c.commit?.author?.date || 'unknown date';
        commitLine = `Latest commit: "${msg}" by ${author} on ${date}.`;
      }
    }
  } catch {
    // keep the "could not be fetched" default — repo metadata alone is still useful
  }

  return (
    `[${originalUrl}]: GitHub repo "${data.full_name}". ` +
    `Description: ${data.description ? `"${data.description}"` : '(none)'}. ` +
    `Fork: ${Boolean(data.fork)}. Stars: ${data.stargazers_count}. ` +
    `Last pushed: ${data.pushed_at}. Default branch: ${data.default_branch}. ` +
    `Language: ${data.language || '(none detected)'}. ` +
    `${looksEmpty ? 'WARNING: the repository appears to be EMPTY (size 0). ' : ''}` +
    commitLine
  );
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function describeGenericUrl(url, originalUrl) {
  const res = await fetchWithTimeout(url.href);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!res.ok) {
    return `[${originalUrl}]: the URL responded with HTTP ${res.status} — the linked page could not be retrieved successfully.`;
  }
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    return `[${originalUrl}]: URL is live (HTTP ${res.status}) but returned non-text content (content-type: ${contentType || 'unknown'}); content not inspected.`;
  }
  const body = await res.text();
  const snippet = (contentType.includes('text/html') ? stripHtml(body) : body).slice(0, SNIPPET_CHARS);
  return `[${originalUrl}]: fetched page content (HTTP ${res.status}, ${contentType.split(';')[0]}), truncated snippet follows:\n"${snippet}"`;
}

async function describeUrl(urlString) {
  let safeUrl;
  try {
    safeUrl = await assertSafeUrl(urlString);
  } catch (err) {
    return (
      `[${urlString}]: this link was found in the proof but was NOT fetched — blocked or unusable ` +
      `(reason: ${err.message}). An unverifiable link should reduce your confidence in the proof, not be ignored.`
    );
  }
  try {
    const gh = parseGitHubRepo(safeUrl);
    if (gh) return await describeGitHubRepo(gh, urlString);
    return await describeGenericUrl(safeUrl, urlString);
  } catch (err) {
    const reason = err.name === 'AbortError' ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : err.message || String(err);
    return (
      `[${urlString}]: a link was found in the proof but could not be automatically verified ` +
      `(reason: ${reason}). An unverifiable link should reduce your confidence in the proof, not be ignored.`
    );
  }
}

// Public entry point. Returns proofText unchanged when it contains no URLs;
// otherwise returns proofText with a clearly delimited, server-fetched
// verification section appended. Never throws.
export async function enrichProofContent(proofText) {
  try {
    const urls = extractUrls(proofText || '');
    if (urls.length === 0) return proofText;

    const results = await Promise.all(urls.map((u) => describeUrl(u)));

    return (
      `${proofText}\n\n` +
      `--- Automatically verified content for link(s) found in the proof ---\n` +
      `NOTE TO JUDGE: everything in this section was fetched live by the judging server itself, ` +
      `directly from the linked address(es). It is ground truth about what actually exists at each link, ` +
      `independent of the staker. Check the staker's own claims in the proof text above against it — ` +
      `contradictions, missing repos, or unverifiable links are reasons for skepticism.\n\n` +
      `${results.join('\n\n')}\n` +
      `--- end verified content ---`
    );
  } catch (err) {
    // Absolute backstop: enrichment must never break judging.
    console.error('[linkVerify] enrichment failed, judging raw proof text:', err.message || err);
    return proofText;
  }
}
