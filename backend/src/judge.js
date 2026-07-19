import Anthropic from '@anthropic-ai/sdk';

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
  required: ['success', 'reasoning'],
  additionalProperties: false,
};

// Shared prompt text for every provider, so switching providers (Anthropic,
// Gemini, whatever comes next) doesn't change judging behavior.
function buildPrompt({ description, proofContent }) {
  return `A person committed to: "${description}"\n\nThey submitted this as proof they completed it:\n\n${proofContent}\n\nThe commitment description may include a staker-declared success criteria segment near the end (marked "Success criteria (declared by staker):"). If present, it was written by the staker at creation time, before any proof existed, and it DEFINES the bar the proof must clear. Judge in two steps:\n\nStep 1 — is the stated bar provable at all? If meeting the criteria requires demonstrating an inherently unverifiable quality of the evidence itself (that it is "random", "genuine", "honest", "meaningful", or similar), then no possible submission can demonstrate that quality: the verdict is FAIL, and your reasoning should say the criteria itself is unprovable rather than blame the proof. Only apply this when the unverifiable quality is the thing being judged; criteria that merely mention such a word while asking for something checkable (a link, a file, a stated fact) are still provable.\n\nStep 2 — does the proof clear the stated bar as literally written? If yes, the verdict is PASS. Do not add requirements the staker never stated, and do not fail a proof for being brief or unimpressive when it meets the stated bar. A staker who set themselves an easy bar did so knowingly with their own money at stake; if the bar seems trivial, say so plainly in your reasoning, but the verdict is still PASS. Judging them against a stricter bar they never declared is a wrong verdict. If the proof does not satisfy the criteria as written, the verdict is FAIL.\n\nIf no criteria segment is present, judge against the commitment description alone, and be skeptical of vague, generic, or unconvincing submissions.\n\nIn all cases, direct your skepticism at facts, not at the bar: if the proof's claims are contradicted by the server-verified link content (when present), or a link the criteria depends on could not be verified, that is a FAIL. Real money is on the line, so when it is genuinely ambiguous whether the stated bar itself was met, a wrong PASS is worse than a wrong FAIL.`;
}

// Deterministic fallback used when no real judge is configured. Passes
// anything that looks like a real submission (non-trivial length) so
// local/dev testing doesn't require a key.
class StubJudge {
  async judge({ description, proofContent }) {
    const trimmed = (proofContent || '').trim();
    const success = trimmed.length >= 20;
    return {
      success,
      reasoning: success
        ? 'Stub judge: proof text is non-trivial, passing for local testing.'
        : 'Stub judge: proof text too short to look like a real submission.',
    };
  }
}

class AnthropicJudge {
  constructor() {
    this.client = new Anthropic();
  }

  async judge({ description, proofContent }) {
    const response = await this.client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: JUDGE_SCHEMA },
      },
      messages: [{ role: 'user', content: buildPrompt({ description, proofContent }) }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return JSON.parse(textBlock.text);
  }
}

// Free-tier Google AI Studio key (no billing/card required as of writing).
// Uses the plain REST API over fetch rather than an SDK, so switching to
// this provider needs no new dependency install under time pressure.
// Model id is env-configurable (GEMINI_MODEL) since exact available model
// names shift over time — if the default 404s, set GEMINI_MODEL to whatever
// id shows in https://aistudio.google.com/ for your key.
class GeminiJudge {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  async judge({ description, proofContent }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt({ description, proofContent }) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              success: { type: 'BOOLEAN' },
              reasoning: { type: 'STRING' },
            },
            required: ['success', 'reasoning'],
          },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Gemini API error (${response.status}) using model "${this.model}". If this is a 404, set GEMINI_MODEL in .env to a model id from https://aistudio.google.com/. Detail: ${detail}`
      );
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Gemini returned no usable content: ${JSON.stringify(data)}`);
    return JSON.parse(text);
  }
}

// OpenAI-compatible endpoint, free tier, no card (console.groq.com). Kept as
// a distinct provider from Gemini/Anthropic since all three have different
// failure modes (billing, project permissions, rate limits) — having more
// than one configured lets FallbackJudge route around whichever is down.
class GroqJudge {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }

  async judge({ description, proofContent }) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict judge. Respond with ONLY a JSON object of the exact shape {"success": boolean, "reasoning": string} — no other text.',
          },
          { role: 'user', content: buildPrompt({ description, proofContent }) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Groq API error (${response.status}) using model "${this.model}". Detail: ${detail}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Groq returned no usable content: ${JSON.stringify(data)}`);
    return JSON.parse(text);
  }
}

// Tries each configured real provider in order and falls through to the
// next on any failure (wrong model id, billing, permissions, rate limit,
// network blip), instead of betting the whole judge on one provider being
// up. Only throws if every configured provider failed.
class FallbackJudge {
  constructor(providers) {
    this.providers = providers;
  }

  async judge(input) {
    const errors = [];
    for (const provider of this.providers) {
      try {
        return await provider.judge(input);
      } catch (err) {
        const name = provider.constructor.name;
        console.error(`[judge] ${name} failed, trying next provider:`, err.message || err);
        errors.push(`${name}: ${err.message || err}`);
      }
    }
    throw new Error(`All judge providers failed — ${errors.join(' | ')}`);
  }
}

export function createJudge() {
  // Groq first: as of this deploy it's the only provider actually passing
  // (Gemini 403s on project permissions, Anthropic is billing-blocked).
  // Keeping them configured below means the moment either gets fixed, it's
  // used as an automatic extra layer of redundancy without a code change.
  const providers = [];
  if (process.env.GROQ_API_KEY) providers.push(new GroqJudge());
  if (process.env.GEMINI_API_KEY) providers.push(new GeminiJudge());
  if (process.env.ANTHROPIC_API_KEY) providers.push(new AnthropicJudge());

  if (providers.length === 0) return new StubJudge();
  return new FallbackJudge(providers);
}
