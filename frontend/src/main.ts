import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  getAbiItem,
  http,
  parseEther,
  zeroAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { COMMITMENT_ABI } from './abi';
import { getNetworkConfig, type NetworkConfig } from './config';
import './style.css';

declare global {
  interface Window {
    ethereum?: any;
  }
}

const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;
const LIST_PAGE_SIZE = 5;

const TEMPLATES = [
  { key: 'ship', label: 'Ship It', placeholder: 'Ship the Spark hackathon submission by the deadline' },
  { key: 'quit', label: 'Quit-It Stake', placeholder: 'No sugar for 7 days' },
  { key: 'snooze', label: 'No-Snooze Stake', placeholder: 'Be at my desk by 7am every day this week' },
] as const;

interface Stake {
  staker: Address;
  referee: Address;
  penaltyRecipient: Address;
  stakeAmount: bigint;
  deadline: bigint;
  aiMode: boolean;
  state: number;
  proofHash: `0x${string}`;
}

interface CommitmentEntry {
  id: bigint;
  description: string;
}

const state: {
  account: Address | null;
  chainId: number | null;
  network: NetworkConfig | undefined;
  walletClient: WalletClient | null;
  publicClient: PublicClient | null;
  graceWindow: bigint;
  minDuration: bigint;
  maxDuration: bigint;
  selectedTemplate: (typeof TEMPLATES)[number]['key'];
  commitmentsTab: 'active' | 'needsAction' | 'resolved';
  commitmentsPage: number;
} = {
  account: null,
  chainId: null,
  network: undefined,
  walletClient: null,
  publicClient: null,
  graceWindow: 0n,
  minDuration: 0n,
  maxDuration: 0n,
  selectedTemplate: 'ship',
  commitmentsTab: 'active',
  commitmentsPage: 0,
};

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

const EXPLORER_CONTRACT_URL = 'https://testnet.monadexplorer.com/address/0xB0A6AAdD39b8760213474151bd55BdeB7542d8Fc';

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="top-banner">
    Deployed live on Monad testnet. Real stakes, real payouts.
    <a href="${EXPLORER_CONTRACT_URL}" target="_blank" rel="noopener">See contract</a>
  </div>

  <header>
    <div class="logo"><span class="mark"></span>V<span>ow</span></div>
    <nav>
      <a href="#stake-widget">Stake</a>
      <a href="#how-it-works">How it works</a>
      <a href="#roadmap">Roadmap</a>
    </nav>
    <div class="wallet-bar">
      <div id="wallet-chip" class="wallet-chip">
        <span id="network-badge"></span>
        <span class="chip-sep">/</span>
        <span id="address-pill"></span>
      </div>
      <button id="connect-btn" class="primary">Connect Wallet</button>
    </div>
  </header>

  <div class="content">
    <div class="hero-row">
      <div class="hero">
        <h1>Put your word <span class="accent">on the line.</span></h1>
        <div class="rule"></div>
        <p class="tagline">Stake real money on a commitment. Succeed and get it back. Fail, even by staying silent, and it moves. No one can dodge it.</p>
        <div class="hero-trust">
          <strong>An AI judges your proof, not a person.</strong> It reads what you submit and rules pass or fail on the spot. That exact text is hashed and checked onchain, so what got judged is exactly what gets enforced, nothing swapped in after.
        </div>
      </div>

      <div class="widget-wrap" id="stake-widget">
        <div class="panel">
          <div class="page-tabs">
            <button class="active" aria-current="page" style="cursor:default;">Stake</button>
            <button id="tab-btn-track">Track &rarr;</button>
          </div>

          <div id="template-row" class="template-row"></div>
          <label for="description">What are you committing to</label>
          <input type="text" id="description" placeholder="${TEMPLATES[0].placeholder}" />

          <label for="criteria">What proof will you submit? (optional, helps the AI judge accurately)</label>
          <textarea id="criteria" rows="2" placeholder="e.g. a link to my deployed demo and a link to my GitHub repo"></textarea>
          <div class="warning" id="criteria-warning" style="display:none;"></div>

          <label for="deadline">Deadline</label>
          <input type="datetime-local" id="deadline" />

          <label for="stake">Stake amount</label>
          <input type="number" id="stake" step="0.001" min="0" value="0.02" />
          <div class="hint" id="stake-hint"></div>

          <label for="referee">Referee (leave blank for AI referee)</label>
          <input type="text" id="referee" placeholder="0x... or leave blank for AI mode" />

          <label for="penalty-preset">If you fail, the stake goes to</label>
          <select id="penalty-preset">
            <option value="treasury">Treasury (default, safe)</option>
            <option value="burn">Burn address (gone forever)</option>
            <option value="custom">Custom address (charity, anti-charity, anyone)</option>
            <option value="referee">Your referee's own address</option>
          </select>
          <input type="text" id="penalty-custom" placeholder="0x..." aria-label="Custom penalty address" style="display:none; margin-top:0.5rem;" />
          <div class="warning" id="penalty-warning" style="display:none;"></div>

          <div class="actions-row">
            <button id="create-btn" class="primary" disabled>Connect wallet to create</button>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" id="commitments-section">
      <div id="withdraw-panel" style="display:none;">
        <h2>Pending balance</h2>
        <p id="withdraw-amount"></p>
        <button id="withdraw-btn" class="primary">Withdraw</button>
      </div>

      <h2 style="display:flex; justify-content:space-between; align-items:center;">
        Your commitments
        <button id="refresh-btn">Refresh</button>
      </h2>
      <div id="commitments-list"><p class="empty-state">Connect a wallet to load commitments.</p></div>
    </div>

    <section class="block" id="how-it-works">
      <div class="eyebrow">How it works</div>
      <h2>Three steps, no exceptions.</h2>
      <p class="lead">The mechanism is designed so silence can never be a way out.</p>
      <div class="steps">
        <div class="step">
          <h3>1. Stake &amp; declare</h3>
          <p>Set your commitment, deadline, referee, and exactly where the money goes if you fail.</p>
        </div>
        <div class="step">
          <h3>2. Prove it</h3>
          <p>Submit proof before the deadline. An AI or a named human referee reviews it and signs onchain.</p>
        </div>
        <div class="step">
          <h3>3. It resolves itself</h3>
          <p>Succeed and withdraw your stake. Miss the deadline plus grace window and anyone can trigger the payout, including you doing nothing.</p>
        </div>
      </div>
    </section>

    <section class="block">
      <div class="eyebrow">Why this, not a clone</div>
      <h2>What actually differentiates Vow.</h2>
      <p class="lead">Commitment staking is not a new category. The details below are where the real difference lives.</p>
      <div class="diff-grid">
        <div class="diff-card">
          <h3>Failure can't be dodged by silence</h3>
          <p>Most similar apps rely on the loser to self-report or a centralized cron job. Here, anyone can trigger the payout once the deadline plus grace window passes, including a stranger, a keeper bot, or the loser themselves.</p>
        </div>
        <div class="diff-card">
          <h3>The judge and the payout are cryptographically the same thing</h3>
          <p>The exact proof text that gets judged is the same text that's hashed and checked onchain, with no gap between the two. Most similar designs don't enforce that coupling at all.</p>
        </div>
        <div class="diff-card">
          <h3>Referee is pluggable, not hardcoded</h3>
          <p>Swap between a real AI judge and a named human referee with no contract changes. Most competitors bake in one or the other.</p>
        </div>
        <div class="diff-card">
          <h3>Where the money goes is your call</h3>
          <p>Treasury, burn address, a charity, an anti-charity, or even the referee, with an explicit onchain risk warning if you choose that. Most versions of this idea hardcode a single destination.</p>
        </div>
      </div>
    </section>

    <section class="block" id="roadmap">
      <div class="eyebrow">Where this is going</div>
      <h2>Proof is just the start.</h2>
      <p class="lead">What is live today is the foundation. Here is what we are building toward next.</p>
      <div class="diff-grid vision-grid">
        <div class="diff-card">
          <h3>Video proof</h3>
          <p>Right now proof is text and links. Next up: upload a video straight from your commitment card, so completion is not just claimed, it is shown.</p>
        </div>
        <div class="diff-card">
          <h3>Rewards for showing up</h3>
          <p>Getting your own stake back is the floor, not the ceiling. We are designing a rewards layer for people who consistently meet their commitments, so accountability compounds into something you win, not just something you avoid losing.</p>
        </div>
      </div>
    </section>

    <footer>
      <div class="fcol">
        <h4>Vow</h4>
        <span>Stake real money on your word. Built for Spark, a Monad Foundation hackathon.</span>
      </div>
      <div class="fcol">
        <h4>Product</h4>
        <a href="#how-it-works">How it works</a>
        <a href="${EXPLORER_CONTRACT_URL}" target="_blank" rel="noopener">Contract on explorer</a>
        <span>GitHub (link at submission)</span>
        <span>Demo video (coming soon)</span>
      </div>
    </footer>
    <div class="foot-bottom">Built for Spark (Monad Foundation), 2026. Deployed on Monad testnet.</div>
  </div>
`;

const templateRow = document.getElementById('template-row')!;
const descriptionInput = document.getElementById('description') as HTMLInputElement;
const criteriaInput = document.getElementById('criteria') as HTMLTextAreaElement;
const criteriaWarning = document.getElementById('criteria-warning')!;
const deadlineInput = document.getElementById('deadline') as HTMLInputElement;
const stakeInput = document.getElementById('stake') as HTMLInputElement;
const stakeHint = document.getElementById('stake-hint')!;
const refereeInput = document.getElementById('referee') as HTMLInputElement;
const penaltyPreset = document.getElementById('penalty-preset') as HTMLSelectElement;
const penaltyCustom = document.getElementById('penalty-custom') as HTMLInputElement;
const penaltyWarning = document.getElementById('penalty-warning')!;
const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const walletChip = document.getElementById('wallet-chip')!;
const networkBadge = document.getElementById('network-badge')!;
const addressPill = document.getElementById('address-pill')!;
const withdrawPanel = document.getElementById('withdraw-panel')!;
const withdrawAmount = document.getElementById('withdraw-amount')!;
const withdrawBtn = document.getElementById('withdraw-btn') as HTMLButtonElement;
const commitmentsList = document.getElementById('commitments-list')!;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
const tabBtnTrack = document.getElementById('tab-btn-track') as HTMLButtonElement;
const commitmentsSection = document.getElementById('commitments-section')!;

function scrollToCommitments() {
  commitmentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
tabBtnTrack.addEventListener('click', scrollToCommitments);

const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('header nav a[href^="#"]')];
const navSections = navLinks
  .map((link) => document.querySelector(link.getAttribute('href')!))
  .filter((el): el is Element => el !== null);
if (navSections.length) {
  const setActiveNav = (id: string) => {
    for (const link of navLinks) {
      link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
    }
  };
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      if (visible.length) {
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveNav(visible[0].target.id);
      }
    },
    { rootMargin: '-88px 0px -70% 0px', threshold: 0 },
  );
  navSections.forEach((section) => sectionObserver.observe(section));
}

for (const t of TEMPLATES) {
  const b = document.createElement('button');
  b.textContent = t.label;
  b.className = t.key === state.selectedTemplate ? 'active' : '';
  b.addEventListener('click', () => {
    state.selectedTemplate = t.key;
    descriptionInput.placeholder = t.placeholder;
    [...templateRow.children].forEach((c) => c.classList.remove('active'));
    b.classList.add('active');
  });
  templateRow.appendChild(b);
}

function defaultDeadline(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setSeconds(0, 0);
  // datetime-local expects local wall-clock components, but toISOString()
  // returns UTC — shift by the timezone offset first so the sliced string
  // reads as the intended local time instead of being off by the offset.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
deadlineInput.value = defaultDeadline();

// Words that describe an intrinsic/subjective quality of the evidence rather
// than something checkable in it. No proof text can ever satisfy these — the
// judge (AI or human) has nothing external to check them against, so a
// commitment written this way can never pass and the stake is lost no matter
// what the staker actually did. Catches the failure mode before real money
// locks in, instead of after the deadline when it's too late to fix.
const UNPROVABLE_WORDS =
  /\b(random(?:ly)?|genuine(?:ly)?|honest(?:ly)?|authentic(?:ally|ity)?|sincere(?:ly)?|really|truly|actually|legit(?:imate(?:ly)?)?|meaningful(?:ly)?|worthy|deserving|by myself|on my own|without (?:any )?help|without ai|no ai)\b/i;

function unprovableWarning(criteria: string): string | null {
  const match = criteria.match(UNPROVABLE_WORDS);
  if (!match) return null;
  return (
    `"${match[0]}" describes a quality no proof can show after the fact, so the judge has nothing to check it against. ` +
    `A commitment worded this way risks failing no matter what you actually did. ` +
    `Describe something checkable instead: a specific link or fact the judge can verify directly.`
  );
}

criteriaInput.addEventListener('input', () => {
  const warning = unprovableWarning(criteriaInput.value);
  criteriaWarning.style.display = warning ? 'block' : 'none';
  criteriaWarning.textContent = warning || '';
});

penaltyPreset.addEventListener('change', () => {
  penaltyCustom.style.display = penaltyPreset.value === 'custom' ? 'block' : 'none';
  penaltyWarning.style.display = penaltyPreset.value === 'referee' ? 'block' : 'none';
  if (penaltyPreset.value === 'referee') {
    penaltyWarning.textContent =
      'Your referee profits if you fail. Only pick this if you deeply trust them not to sandbag an honest success.';
  }
});

async function resolvePenaltyRecipient(): Promise<Address> {
  if (penaltyPreset.value === 'burn') return BURN_ADDRESS;
  if (penaltyPreset.value === 'custom') return penaltyCustom.value.trim() as Address;
  if (penaltyPreset.value === 'referee') {
    const ref = refereeInput.value.trim();
    if (!ref) throw new Error('Set a referee address first to use this option.');
    return ref as Address;
  }
  try {
    return (await state.publicClient!.readContract({
      address: state.network!.contractAddress!,
      abi: [{ type: 'function', name: 'treasury', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
      functionName: 'treasury',
    })) as Address;
  } catch (err) {
    // The raw read error is dev-facing noise; the alert path shows err.message.
    console.error('Treasury lookup failed:', err);
    throw new Error('Could not look up the treasury address. Try again in a moment.');
  }
}

// Wallet event listeners are attached once per page load, never per
// connect — reconnecting used to stack a fresh pair of listeners on every
// connectWallet() call (they also survived disconnectWallet()), so one real
// accountsChanged event would fan out into N duplicate render/refresh runs
// racing each other over the list DOM.
let walletListenersAttached = false;

async function connectWallet() {
  if (!window.ethereum) {
    alert('No wallet found. Install MetaMask or another browser wallet, then try again.');
    return;
  }
  state.walletClient = createWalletClient({ transport: custom(window.ethereum) });
  let account: Address | undefined;
  try {
    [account] = await state.walletClient.requestAddresses();
  } catch {
    // User closed or rejected the wallet's connect prompt — nothing to do.
    return;
  }
  state.account = account ?? null;
  await syncChain();
  if (!state.network) {
    await switchToMonadTestnet();
    await syncChain();
  }
  if (!walletListenersAttached) {
    walletListenersAttached = true;
    // accountsChanged with an empty array is the wallet itself ending the
    // session (extension locked, permission revoked, idle timeout). Quietly
    // resetting to the disconnected state is the correct response.
    window.ethereum.on?.('accountsChanged', (accs: Address[]) => {
      state.account = accs[0] ?? null;
      state.commitmentsTab = 'active';
      state.commitmentsPage = 0;
      render();
      refreshList();
    });
    window.ethereum.on?.('chainChanged', () => {
      syncChain().then(() => refreshList());
    });
  }
  render();
  refreshList();
}

// Injected wallets (MetaMask etc.) don't expose an API for a site to force a
// real disconnect — only the wallet's own UI can revoke the connection. This
// clears our local app state instead (the standard pattern most dApps use
// for a "Disconnect" button), so the UI forgets the account even though the
// wallet extension still considers this site approved.
function disconnectWallet() {
  state.account = null;
  state.walletClient = null;
  state.publicClient = null;
  state.chainId = null;
  state.network = undefined;
  state.commitmentsTab = 'active';
  state.commitmentsPage = 0;
  render();
  refreshList();
}

async function syncChain() {
  const chainIdHex: string = await window.ethereum.request({ method: 'eth_chainId' });
  state.chainId = parseInt(chainIdHex, 16);
  state.network = getNetworkConfig(state.chainId);
  state.publicClient = createPublicClient({ transport: custom(window.ethereum) }) as unknown as PublicClient;
  if (state.network?.contractAddress) {
    try {
      state.graceWindow = (await state.publicClient.readContract({
        address: state.network.contractAddress,
        abi: COMMITMENT_ABI,
        functionName: 'GRACE_WINDOW',
      })) as bigint;
      state.minDuration = (await state.publicClient.readContract({
        address: state.network.contractAddress,
        abi: COMMITMENT_ABI,
        functionName: 'MIN_DURATION',
      })) as bigint;
      state.maxDuration = (await state.publicClient.readContract({
        address: state.network.contractAddress,
        abi: COMMITMENT_ABI,
        functionName: 'MAX_DURATION',
      })) as bigint;
    } catch (err) {
      // A transient read failure here must not abort the whole connect flow
      // (it previously threw out of connectWallet before render() ran,
      // leaving the UI stuck looking half-connected).
      console.warn('Could not read grace window, keeping previous value', err);
    }
  }
}

async function switchToMonadTestnet() {
  try {
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: '0x279f',
          chainName: 'Monad Testnet',
          nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
          rpcUrls: ['https://testnet-rpc.monad.xyz/'],
          blockExplorerUrls: ['https://testnet.monadexplorer.com'],
        },
      ],
    });
  } catch (err) {
    console.error(err);
  }
}

// Contract custom error names, translated to plain English. The ABI now
// declares these so viem can decode a revert into one of these names
// instead of an opaque blob, but the raw name itself ("InvalidDuration")
// still reads like source code, not something a non-technical person
// staking money should see as-is.
const REVERT_REASONS: Record<string, string> = {
  Paused: 'Creating new commitments is temporarily paused.',
  AiPaused: 'The AI referee is temporarily paused. Try a human referee instead.',
  InvalidReferee: "The referee can't be your own address.",
  InvalidPenaltyRecipient: "The penalty recipient can't be your own address, and can't be blank.",
  InvalidDuration: 'The deadline is out of range. It needs to be at least 1 hour and at most 30 days from now.',
  InsufficientStake: 'The stake amount is below the minimum required.',
  StakeTooHighForAi: 'That stake is too large for AI mode. Use a lower amount or a human referee.',
  NotStaker: 'Only the person who created this commitment can do that.',
  NotActive: 'This commitment has already been resolved.',
  DeadlinePassed: "The deadline has already passed, so this can't be submitted anymore.",
  GraceWindowPassed: 'The grace window has already passed, so this can no longer be confirmed.',
  GraceWindowNotPassed: "The grace window hasn't passed yet, so this can't be closed out as failed.",
  SignatureExpired: 'The AI signature expired before it was submitted. Request a fresh judgment and try again.',
  InvalidSignature: 'The signature is not valid for this commitment.',
  NotReferee: "Only this commitment's named referee can confirm it.",
  NothingToWithdraw: "There's nothing to withdraw right now.",
  TransferFailed: 'The transfer failed. Try again in a moment.',
};

// Turns a raw wallet/contract error into something a person staking real
// money can act on. Keeps genuinely useful details (cancellation,
// insufficient funds, a clean revert reason) and sends the rest to the
// console instead of the screen.
function friendlyTxError(err: any): string {
  const raw = String(err?.shortMessage || err?.message || err || '');
  if (raw.startsWith('REVERTED:')) {
    return raw.slice('REVERTED:'.length);
  }
  const lower = raw.toLowerCase();
  if (err?.code === 4001 || lower.includes('user rejected') || lower.includes('user denied')) {
    return 'Transaction canceled in your wallet.';
  }
  if (lower.includes('insufficient funds') || lower.includes('exceeds the balance')) {
    return 'Not enough funds in your wallet to cover this transaction.';
  }
  for (const [name, plain] of Object.entries(REVERT_REASONS)) {
    if (raw.includes(name)) return plain;
  }
  // A named revert reason from the contract is short and plain, keep it.
  const revertMatch = raw.match(/reverted with the following reason:\s*\n?(.+)/i);
  if (revertMatch) {
    return revertMatch[1].split('\n')[0].trim();
  }
  console.error('Transaction failed:', err);
  return 'The transaction could not go through. Please try again in a moment.';
}

// waitForTransactionReceipt resolves as soon as a transaction is MINED, not
// as soon as it SUCCEEDS — a reverted transaction still gets a receipt and
// this call still resolves normally. Every write in this app must check
// this before treating a transaction as having actually done anything,
// otherwise a revert silently looks like success (form clears, list
// refreshes showing nothing changed, no error shown).
function assertMined(receipt: { status: string }, action: string) {
  if (receipt.status !== 'success') {
    throw new Error(
      `REVERTED:This ${action} did not go through on-chain (the transaction reverted). Nothing changed, so double check the details and try again.`
    );
  }
}

function render() {
  const connected = Boolean(state.account);
  walletChip.classList.toggle('visible', connected);
  walletChip.classList.toggle('unsupported', connected && !state.network?.contractAddress);

  if (connected) {
    addressPill.textContent = `${state.account!.slice(0, 6)}...${state.account!.slice(-4)}`;
    networkBadge.textContent = state.network?.contractAddress
      ? state.network.name
      : 'Unsupported network';
  }

  connectBtn.textContent = connected ? 'Disconnect' : 'Connect Wallet';
  connectBtn.classList.toggle('primary', !connected);

  const ready = Boolean(state.account && state.network?.contractAddress);
  createBtn.disabled = !ready;
  createBtn.textContent = ready
    ? 'Create Commitment'
    : state.account
    ? 'Unsupported network'
    : 'Connect wallet to create';

  stakeHint.textContent = state.network ? `in ${state.network.currencySymbol}, plus a small protocol fee` : '';
}

async function createCommitment() {
  if (!state.account || !state.walletClient || !state.network?.contractAddress) return;
  let description = descriptionInput.value.trim();
  if (!description) return alert('Describe what you are committing to.');

  // The contract stores/emits description as an opaque string, so staker
  // declared success criteria are folded into it client side. The backend
  // judge prompt knows to look for this segment. No contract change needed.
  const criteria = criteriaInput.value.trim();
  if (criteria) {
    description = `${description}\n\nSuccess criteria (declared by staker): ${criteria}`;
  }

  const deadlineSeconds = BigInt(Math.floor(new Date(deadlineInput.value).getTime() / 1000));
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (state.minDuration > 0n && deadlineSeconds - nowSeconds < state.minDuration) {
    const minHours = Number(state.minDuration) / 3600;
    return alert(`The deadline needs to be at least ${minHours} hour${minHours === 1 ? '' : 's'} from now.`);
  }
  if (state.maxDuration > 0n && deadlineSeconds - nowSeconds > state.maxDuration) {
    const maxDays = Number(state.maxDuration) / 86400;
    return alert(`The deadline can be at most ${maxDays} day${maxDays === 1 ? '' : 's'} from now.`);
  }
  const stakeEth = parseFloat(stakeInput.value);
  if (!(stakeEth > 0)) return alert('Set a stake amount.');

  const refereeRaw = refereeInput.value.trim();
  const referee = (refereeRaw || zeroAddress) as Address;

  let penaltyRecipient: Address;
  try {
    penaltyRecipient = await resolvePenaltyRecipient();
  } catch (err: any) {
    return alert(err.message || String(err));
  }
  if (!penaltyRecipient) return alert('Set a penalty recipient address.');

  const protocolFee = parseEther('0.001');
  const value = parseEther(stakeInput.value) + protocolFee;

  try {
    createBtn.disabled = true;
    createBtn.textContent = 'Confirm in wallet...';
    const hash = await state.walletClient.writeContract({
      account: state.account,
      chain: null,
      address: state.network.contractAddress,
      abi: COMMITMENT_ABI,
      functionName: 'createCommitment',
      args: [description, deadlineSeconds, referee, penaltyRecipient],
      value,
    });
    createBtn.textContent = 'Waiting for confirmation...';
    const receipt = await state.publicClient!.waitForTransactionReceipt({ hash });
    assertMined(receipt, 'commitment creation');
    descriptionInput.value = '';
    criteriaInput.value = '';
    await refreshList();
    scrollToCommitments();
  } catch (err: any) {
    alert(friendlyTxError(err));
  } finally {
    render();
  }
}

// ---------------------------------------------------------------------------
// Event-log scanning.
//
// Public Monad testnet RPCs hard-cap the eth_getLogs block span, each
// differently (measured live 2026-07-18: the official RPC rejects any span
// over 100 blocks with -32614 "eth_getLogs is limited to a 100 range"; drpc
// rejects spans over 1000). A single deploy-to-latest query therefore breaks
// as soon as the chain outgrows the cap — which is exactly what bit this app
// twice. And a naive one-chunk-at-a-time backward scan through the wallet's
// provider gets unusably slow as history grows (measured: ~57s to reach a
// commitment only ~9k blocks old).
//
// The scan below:
//  - hits the configured scan RPCs directly over HTTP (not via the wallet,
//    whose backing RPC and caps are unknown), with per-endpoint span caps
//    and fallback to the next endpoint if one fails mid-scan;
//  - fetches both event types in ONE eth_getLogs per chunk (OR topic
//    filter), several chunks in parallel per wave;
//  - walks backward from the head and stops as soon as every commitment id
//    reported by the contract's own nextId counter has been found (any
//    Failed event lands at or after its commitment's creation block, so by
//    the time every creation is found, every Failed event is too);
//  - caches results in localStorage so later refreshes only scan blocks
//    newer than the previous scan's head (the delta is always scanned in
//    full, never early-stopped, so late Failed events for old commitments
//    are still picked up);
//  - always sends numeric from/to blocks. Passing the literal "latest" as
//    toBlock is racy: the node may resolve it a few blocks past the head the
//    span was computed from, pushing the range over the cap (confirmed live).
// ---------------------------------------------------------------------------

const CREATED_EVENT = getAbiItem({ abi: COMMITMENT_ABI, name: 'CommitmentCreated' });
const FAILED_EVENT = getAbiItem({ abi: COMMITMENT_ABI, name: 'Failed' });
const SCAN_CONCURRENCY = 8; // parallel getLogs chunks per wave
// Re-scan a little below the cached watermark in case blocks near the head
// we cached at were later reorged (Monad finality is fast; this is ample).
const CACHE_OVERLAP = 100n;

interface ScanResult {
  created: CommitmentEntry[];
  failedIds: Set<string>;
}

interface ScanCacheShape {
  entries: { id: string; description: string }[];
  failedIds: string[];
  scannedTo: string;
}

function scanCacheKey(): string {
  return `vow-scan-${state.chainId}-${state.network?.contractAddress}`;
}

function readScanCache(): ScanCacheShape | null {
  try {
    const raw = localStorage.getItem(scanCacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const isDigits = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v);
    if (
      !Array.isArray(parsed.entries) ||
      !Array.isArray(parsed.failedIds) ||
      !isDigits(parsed.scannedTo) ||
      !parsed.entries.every((e: any) => isDigits(e?.id) && typeof e?.description === 'string')
    ) {
      return null;
    }
    return parsed as ScanCacheShape;
  } catch {
    return null;
  }
}

function writeScanCache(seen: Map<string, CommitmentEntry>, failedIds: Set<string>, scannedTo: bigint) {
  try {
    const payload: ScanCacheShape = {
      entries: [...seen.values()].map((e) => ({ id: e.id.toString(), description: e.description })),
      failedIds: [...failedIds],
      scannedTo: scannedTo.toString(),
    };
    localStorage.setItem(scanCacheKey(), JSON.stringify(payload));
  } catch {
    // Private mode / quota — the cache is best-effort only.
  }
}

const scanClients = new Map<string, PublicClient>();
function scanClientFor(url: string): PublicClient {
  let client = scanClients.get(url);
  if (!client) {
    client = createPublicClient({ transport: http(url) }) as unknown as PublicClient;
    scanClients.set(url, client);
  }
  return client;
}

// Scans [floor, top] backward in waves of parallel chunks, folding results
// into `seen`/`failedIds`. Stops early once `seen` holds `target` distinct
// commitments (pass Infinity to force a full scan of the range).
async function scanRange(
  client: PublicClient,
  address: Address,
  maxSpan: bigint,
  top: bigint,
  floor: bigint,
  target: number,
  seen: Map<string, CommitmentEntry>,
  failedIds: Set<string>,
  onProgress?: (blocksLeft: bigint) => void
): Promise<void> {
  let to = top;
  while (to >= floor && seen.size < target) {
    const ranges: { from: bigint; to: bigint }[] = [];
    while (ranges.length < SCAN_CONCURRENCY && to >= floor) {
      const from = to - maxSpan > floor ? to - maxSpan : floor;
      ranges.push({ from, to });
      to = from - 1n;
    }
    const waves = await Promise.all(
      ranges.map((r) =>
        client.getLogs({
          address,
          events: [CREATED_EVENT, FAILED_EVENT],
          fromBlock: r.from,
          toBlock: r.to,
        })
      )
    );
    for (const logs of waves) {
      for (const log of logs as any[]) {
        if (log.eventName === 'CommitmentCreated') {
          const idStr = (log.args.id as bigint).toString();
          if (!seen.has(idStr)) {
            seen.set(idStr, { id: log.args.id as bigint, description: log.args.description as string });
          }
        } else if (log.eventName === 'Failed') {
          failedIds.add((log.args.id as bigint).toString());
        }
      }
    }
    onProgress?.(to >= floor ? to - floor + 1n : 0n);
  }
}

async function scanCommitmentEvents(
  deployBlock: bigint,
  targetCount: number,
  onProgress?: (blocksLeft: bigint) => void
): Promise<ScanResult> {
  if (!state.network?.contractAddress || targetCount === 0) {
    return { created: [], failedIds: new Set() };
  }
  const address = state.network.contractAddress;
  let lastError: unknown = null;

  for (const rpc of state.network.logScanRpcs) {
    const client = scanClientFor(rpc.url);
    try {
      const seen = new Map<string, CommitmentEntry>();
      const failedIds = new Set<string>();
      const head = await client.getBlockNumber();

      const cached = readScanCache();
      let complete = false;
      if (cached) {
        for (const e of cached.entries) seen.set(e.id, { id: BigInt(e.id), description: e.description });
        for (const f of cached.failedIds) failedIds.add(f);
        let floor = BigInt(cached.scannedTo) + 1n - CACHE_OVERLAP;
        if (floor < deployBlock) floor = deployBlock;
        if (floor <= head) {
          // Delta since the last scan: always scanned in full (no early
          // stop), so Failed events emitted since then are never missed.
          await scanRange(client, address, rpc.maxSpan, head, floor, Infinity, seen, failedIds, onProgress);
        }
        complete = seen.size >= targetCount;
        if (!complete) {
          // Cache was stale or corrupt — fall through to a full rescan.
          seen.clear();
          failedIds.clear();
        }
      }
      if (!complete) {
        await scanRange(client, address, rpc.maxSpan, head, deployBlock, targetCount, seen, failedIds, onProgress);
      }

      writeScanCache(seen, failedIds, head);
      const created = [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { created, failedIds };
    } catch (err) {
      lastError = err;
      console.warn(`Event scan via ${rpc.url} failed, trying next endpoint`, err);
    }
  }
  throw lastError ?? new Error('No log-scan RPC endpoints configured for this network.');
}

function formatCountdown(deadline: bigint, graceWindow: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) {
    return now > deadline + graceWindow ? 'expired, ready to close out' : 'deadline passed, grace period running';
  }
  const secs = Number(deadline - now);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m left`;
}

function isExpired(stakeData: Stake): boolean {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return stakeData.state === 0 && now > stakeData.deadline;
}

function renderCommitmentCard(entry: CommitmentEntry, stakeData: Stake, failedIds: Set<string>): HTMLElement {
  const card = document.createElement('div');
  card.className = 'commitment-card';

  const isStaker = Boolean(state.account && stakeData.staker.toLowerCase() === state.account.toLowerCase());
  const now = BigInt(Math.floor(Date.now() / 1000));
  const graceOver = now > stakeData.deadline + state.graceWindow;
  const hasProof = stakeData.proofHash !== ZERO_HASH;
  const symbol = state.network?.currencySymbol ?? '';
  const failed = failedIds.has(entry.id.toString());

  let statusLabel = 'active';
  let statusClass = 'active';
  if (stakeData.state === 1) {
    statusLabel = failed ? 'failed' : 'succeeded';
    statusClass = failed ? 'resolved-failed' : 'resolved-success';
  } else if (isExpired(stakeData)) {
    statusLabel = graceOver ? 'expired' : 'grace period';
    statusClass = graceOver ? 'resolved-failed' : 'active';
  }

  card.innerHTML = `
    <div class="top-row">
      <span class="desc">#${entry.id} ${entry.description}</span>
      <span class="status-pill ${statusClass}">${statusLabel}</span>
    </div>
    <div class="meta-row">
      <span>staker ${stakeData.staker.slice(0, 6)}...${stakeData.staker.slice(-4)}</span>
      <span>${formatEther(stakeData.stakeAmount)} ${symbol} staked</span>
      <span>${stakeData.aiMode ? 'AI referee' : 'human referee'}</span>
      <span>${stakeData.state === 0 ? formatCountdown(stakeData.deadline, state.graceWindow) : ''}</span>
    </div>
  `;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (stakeData.state === 0 && isStaker && !hasProof) {
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Describe/link your proof that you completed this...';
    const submitBtn = document.createElement('button');
    submitBtn.className = 'primary';
    submitBtn.textContent = 'Submit Proof';
    submitBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) return alert('Add some proof text first.');
      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Confirm in wallet...';
        const hash = await state.walletClient!.writeContract({
          account: state.account!,
          chain: null,
          address: state.network!.contractAddress!,
          abi: COMMITMENT_ABI,
          functionName: 'submitProof',
          args: [entry.id, text],
        });
        const receipt = await state.publicClient!.waitForTransactionReceipt({ hash });
        assertMined(receipt, 'proof submission');
        localStorage.setItem(`proof-${entry.id}`, text);
        await refreshList();
      } catch (err: any) {
        alert(friendlyTxError(err));
      }
    });
    actions.appendChild(textarea);
    actions.appendChild(submitBtn);
  }

  if (stakeData.state === 0 && hasProof && stakeData.aiMode) {
    const cached = localStorage.getItem(`proof-${entry.id}`);
    let proofBox: HTMLTextAreaElement | null = null;
    if (!cached) {
      proofBox = document.createElement('textarea');
      proofBox.placeholder = 'Re-enter the proof text you submitted, so it can be judged...';
      actions.appendChild(proofBox);
    }
    const judgeBtn = document.createElement('button');
    judgeBtn.className = 'primary';
    judgeBtn.textContent = 'Get AI Judgment';
    const resultBox = document.createElement('div');
    judgeBtn.addEventListener('click', async () => {
      const proofText = cached || proofBox?.value.trim();
      if (!proofText) return alert('Enter the proof text.');
      judgeBtn.disabled = true;
      judgeBtn.textContent = 'Judging...';
      try {
        const res = await fetch(`${state.network!.backendUrl}/judge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: Number(entry.id),
            description: entry.description,
            proofText,
          }),
        });
        const data = await res.json();
        if (!res.ok || typeof data.success !== 'boolean') {
          // Server-side error ({error: ...} shape) — render it as an error,
          // not as a judged FAIL, so a backend hiccup can't masquerade as
          // the AI rejecting the proof. A 400 means the user did something
          // fixable (proof text mismatch, wrong referee mode, already
          // resolved) and server.js's message is already plain and safe to
          // show as-is. A 500 means something broke on our end (billing,
          // provider outage, internal error) — that detail is dev-facing
          // only, so it goes to the console and the user sees a generic
          // "try again" instead.
          resultBox.className = 'judge-result error';
          if (res.status === 400 && data.error) {
            resultBox.textContent = data.error;
          } else {
            console.error('Judge request returned an error:', data.error, data.detail);
            resultBox.textContent = "The AI judge couldn't process this right now. Try again in a moment.";
          }
          actions.appendChild(resultBox);
          return;
        }
        resultBox.className = `judge-result ${data.success ? 'pass' : 'fail'}`;
        resultBox.textContent = `${data.success ? 'PASS' : 'FAIL'}: ${data.reasoning}`;
        actions.appendChild(resultBox);
        if (data.success) {
          const confirmBtn = document.createElement('button');
          confirmBtn.className = 'primary';
          confirmBtn.textContent = 'Confirm Success Onchain';
          confirmBtn.addEventListener('click', async () => {
            try {
              confirmBtn.disabled = true;
              confirmBtn.textContent = 'Confirm in wallet...';
              const hash = await state.walletClient!.writeContract({
                account: state.account!,
                chain: null,
                address: state.network!.contractAddress!,
                abi: COMMITMENT_ABI,
                functionName: 'confirmSuccess',
                args: [entry.id, BigInt(data.expiry), data.signature],
              });
              const receipt = await state.publicClient!.waitForTransactionReceipt({ hash });
              assertMined(receipt, 'confirmation');
              await refreshList();
            } catch (err: any) {
              alert(friendlyTxError(err));
            }
          });
          actions.appendChild(confirmBtn);
        }
      } catch (err: any) {
        console.error('Judge request failed:', err);
        resultBox.className = 'judge-result error';
        resultBox.textContent = "Couldn't reach the AI judge right now. Try again in a moment.";
        actions.appendChild(resultBox);
      } finally {
        judgeBtn.disabled = false;
        judgeBtn.textContent = 'Get AI Judgment';
      }
    });
    actions.appendChild(judgeBtn);

    if (isStaker) {
      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Submit Different Proof';
      const retryBox = document.createElement('div');
      retryBox.style.cssText = 'display:none; flex-basis:100%; gap:0.5rem; flex-direction:column;';
      const retryTextarea = document.createElement('textarea');
      retryTextarea.placeholder = 'Replace your submitted proof with new text before re-judging...';
      const retrySubmitBtn = document.createElement('button');
      retrySubmitBtn.className = 'primary';
      retrySubmitBtn.textContent = 'Resubmit Proof';
      retrySubmitBtn.addEventListener('click', async () => {
        const text = retryTextarea.value.trim();
        if (!text) return alert('Add some proof text first.');
        try {
          retrySubmitBtn.disabled = true;
          retrySubmitBtn.textContent = 'Confirm in wallet...';
          const hash = await state.walletClient!.writeContract({
            account: state.account!,
            chain: null,
            address: state.network!.contractAddress!,
            abi: COMMITMENT_ABI,
            functionName: 'submitProof',
            args: [entry.id, text],
          });
          const receipt = await state.publicClient!.waitForTransactionReceipt({ hash });
          assertMined(receipt, 'proof submission');
          localStorage.setItem(`proof-${entry.id}`, text);
          await refreshList();
        } catch (err: any) {
          alert(friendlyTxError(err));
        } finally {
          retrySubmitBtn.disabled = false;
          retrySubmitBtn.textContent = 'Resubmit Proof';
        }
      });
      retryBtn.addEventListener('click', () => {
        retryBox.style.display = retryBox.style.display === 'none' ? 'flex' : 'none';
      });
      retryBox.appendChild(retryTextarea);
      retryBox.appendChild(retrySubmitBtn);
      actions.appendChild(retryBtn);
      actions.appendChild(retryBox);
    }
  }

  let failBtn: HTMLButtonElement | null = null;
  if (stakeData.state === 0 && graceOver) {
    failBtn = document.createElement('button');
    failBtn.className = 'danger';
    failBtn.textContent = 'Execute Failure (anyone can trigger this)';
    failBtn.addEventListener('click', async () => {
      if (!state.account) return alert('Connect a wallet first. Anyone can call this, but a wallet is needed to send the transaction.');
      try {
        failBtn!.disabled = true;
        const hash = await state.walletClient!.writeContract({
          account: state.account,
          chain: null,
          address: state.network!.contractAddress!,
          abi: COMMITMENT_ABI,
          functionName: 'executeFailure',
          args: [entry.id],
        });
        const receipt = await state.publicClient!.waitForTransactionReceipt({ hash });
        assertMined(receipt, 'failure execution');
        await refreshList();
      } catch (err: any) {
        alert(friendlyTxError(err));
      }
    });
    actions.appendChild(failBtn);
  }

  // Once grace is over, the commitment is effectively failed and only
  // waiting on someone to call executeFailure — proof submission or AI
  // judging at that point can't change the outcome, so every other
  // control in the card is switched off. Only the execute button (the
  // one action that still does something) stays live.
  if (graceOver) {
    actions.querySelectorAll('button, textarea').forEach((el) => {
      if (el !== failBtn) {
        (el as HTMLButtonElement | HTMLTextAreaElement).disabled = true;
      }
    });
  }

  card.appendChild(actions);
  return card;
}

async function refreshList() {
  // Checking account too (not just the clients) matters for the wallet
  // locking or revoking the session on its own: accountsChanged fires with
  // no accounts, and without this check the list would still scan and then
  // tell a signed-out user "You haven't created a commitment yet."
  if (!state.account || !state.publicClient || !state.network?.contractAddress) {
    commitmentsList.innerHTML = '<p class="empty-state">Connect a wallet to load commitments.</p>';
    return;
  }
  let entries: CommitmentEntry[];
  let failedIds: Set<string>;
  try {
    const nextId = (await state.publicClient.readContract({
      address: state.network.contractAddress,
      abi: COMMITMENT_ABI,
      functionName: 'nextId',
    })) as bigint;
    if (nextId > 0n) {
      commitmentsList.innerHTML = '<p class="empty-state">Loading your commitments&hellip;</p>';
    }
    ({ created: entries, failedIds } = await scanCommitmentEvents(state.network.deployBlock, Number(nextId)));
  } catch (err: any) {
    console.error('Failed to load commitments', err);
    commitmentsList.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Could not load commitments right now. Hit Refresh to try again.';
    commitmentsList.appendChild(p);
    return;
  }
  if (entries.length === 0) {
    commitmentsList.innerHTML = '<p class="empty-state">No commitments yet. Be the first.</p>';
  } else {
    commitmentsList.innerHTML = '';
    try {
      // "Your commitments" means yours — filter to the connected staker
      // instead of listing everyone's, so the list stays short and the
      // heading matches what it actually shows.
      const own: { entry: CommitmentEntry; stake: Stake }[] = [];
      for (const entry of entries.slice().reverse()) {
        const stakeData = (await state.publicClient.readContract({
          address: state.network.contractAddress,
          abi: COMMITMENT_ABI,
          functionName: 'getStake',
          args: [entry.id],
        })) as Stake;
        if (state.account && stakeData.staker.toLowerCase() === state.account.toLowerCase()) {
          own.push({ entry, stake: stakeData });
        }
      }

      if (own.length === 0) {
        commitmentsList.innerHTML = '<p class="empty-state">You haven\'t created a commitment yet.</p>';
      } else {
        const active = own.filter((o) => o.stake.state === 0 && !isExpired(o.stake));
        const expired = own.filter((o) => o.stake.state === 0 && isExpired(o.stake));
        const resolved = own.filter((o) => o.stake.state !== 0);

        // A tab per category instead of stacking all three vertically —
        // most visits only care about one bucket, so this keeps the panel
        // short no matter how many commitments pile up over time. Within
        // a tab, real Prev/Next paging (not an accumulating "show more")
        // keeps each page a fixed, bounded size.
        const tabs: { key: typeof state.commitmentsTab; label: string; items: typeof active; emptyText: string }[] = [
          { key: 'active', label: 'Active', items: active, emptyText: 'Nothing active right now.' },
          {
            key: 'needsAction',
            label: 'Needs action',
            items: expired,
            emptyText: 'Nothing waiting on execution.',
          },
          { key: 'resolved', label: 'Resolved', items: resolved, emptyText: 'Nothing resolved yet.' },
        ];

        const tabBar = document.createElement('div');
        tabBar.className = 'page-tabs commitments-tabs';
        for (const tab of tabs) {
          const btn = document.createElement('button');
          btn.textContent = `${tab.label} (${tab.items.length})`;
          btn.className = state.commitmentsTab === tab.key ? 'active' : '';
          btn.addEventListener('click', () => {
            if (state.commitmentsTab === tab.key) return;
            state.commitmentsTab = tab.key;
            state.commitmentsPage = 0;
            refreshList();
          });
          tabBar.appendChild(btn);
        }
        commitmentsList.appendChild(tabBar);

        const currentTab = tabs.find((t) => t.key === state.commitmentsTab) ?? tabs[0];
        if (currentTab.items.length === 0) {
          const p = document.createElement('p');
          p.className = 'empty-state';
          p.textContent = currentTab.emptyText;
          commitmentsList.appendChild(p);
        } else {
          const totalPages = Math.ceil(currentTab.items.length / LIST_PAGE_SIZE);
          state.commitmentsPage = Math.min(state.commitmentsPage, totalPages - 1);
          const start = state.commitmentsPage * LIST_PAGE_SIZE;
          for (const { entry, stake } of currentTab.items.slice(start, start + LIST_PAGE_SIZE)) {
            commitmentsList.appendChild(renderCommitmentCard(entry, stake, failedIds));
          }
          if (totalPages > 1) {
            const pager = document.createElement('div');
            pager.className = 'pager';
            const prevBtn = document.createElement('button');
            prevBtn.textContent = '← Prev';
            prevBtn.disabled = state.commitmentsPage === 0;
            prevBtn.addEventListener('click', () => {
              state.commitmentsPage -= 1;
              refreshList();
            });
            const pageLabel = document.createElement('span');
            pageLabel.className = 'pager-label';
            pageLabel.textContent = `Page ${state.commitmentsPage + 1} of ${totalPages}`;
            const nextBtn = document.createElement('button');
            nextBtn.textContent = 'Next →';
            nextBtn.disabled = state.commitmentsPage >= totalPages - 1;
            nextBtn.addEventListener('click', () => {
              state.commitmentsPage += 1;
              refreshList();
            });
            pager.appendChild(prevBtn);
            pager.appendChild(pageLabel);
            pager.appendChild(nextBtn);
            commitmentsList.appendChild(pager);
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load commitment details', err);
      const p = document.createElement('p');
      p.className = 'empty-state';
      p.textContent = 'Could not load all commitment details. Hit Refresh to try again.';
      commitmentsList.appendChild(p);
    }
  }

  if (state.account) {
    try {
      const balance = (await state.publicClient.readContract({
        address: state.network.contractAddress,
        abi: COMMITMENT_ABI,
        functionName: 'balances',
        args: [state.account],
      })) as bigint;
      if (balance > 0n) {
        withdrawPanel.style.display = 'block';
        withdrawAmount.textContent = `${formatEther(balance)} ${state.network.currencySymbol} ready to withdraw.`;
      } else {
        withdrawPanel.style.display = 'none';
      }
    } catch (err) {
      console.error('Failed to load withdrawable balance', err);
    }
  }
}

withdrawBtn.addEventListener('click', async () => {
  if (!state.account || !state.walletClient || !state.network?.contractAddress) return;
  try {
    withdrawBtn.disabled = true;
    const hash = await state.walletClient.writeContract({
      account: state.account,
      chain: null,
      address: state.network.contractAddress,
      abi: COMMITMENT_ABI,
      functionName: 'withdraw',
    });
    const receipt = await state.publicClient!.waitForTransactionReceipt({ hash });
    assertMined(receipt, 'withdrawal');
    await refreshList();
  } catch (err: any) {
    alert(friendlyTxError(err));
  } finally {
    withdrawBtn.disabled = false;
  }
});

connectBtn.addEventListener('click', () => (state.account ? disconnectWallet() : connectWallet()));
createBtn.addEventListener('click', createCommitment);
refreshBtn.addEventListener('click', refreshList);

render();
