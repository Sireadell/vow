import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  parseEther,
  zeroAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { COMMITMENT_ABI } from './abi';
import { NETWORKS, getNetworkConfig, type NetworkConfig } from './config';
import './style.css';

declare global {
  interface Window {
    ethereum?: any;
  }
}

const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;

const TEMPLATES = [
  { key: 'ship', label: 'Ship-It Stake', placeholder: 'Ship the Spark hackathon submission by the deadline' },
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
  selectedTemplate: (typeof TEMPLATES)[number]['key'];
} = {
  account: null,
  chainId: null,
  network: undefined,
  walletClient: null,
  publicClient: null,
  graceWindow: 0n,
  selectedTemplate: 'ship',
};

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

const app = document.getElementById('app')!;
app.innerHTML = `
  <header>
    <h1>Ship-It <span>Stake</span></h1>
    <div class="wallet-bar">
      <span id="network-badge" class="network-badge">not connected</span>
      <span id="address-pill" class="address-pill"></span>
      <button id="connect-btn" class="primary">Connect Wallet</button>
    </div>
  </header>
  <p class="tagline">Stake real money on a commitment. Succeed and get it back. Fail — even by staying silent — and it moves. No one can dodge it.</p>

  <div id="create-panel" class="panel">
    <h2>Make a commitment</h2>
    <div id="template-row" class="template-row"></div>
    <label for="description">What are you committing to</label>
    <input type="text" id="description" placeholder="${TEMPLATES[0].placeholder}" />

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
    <input type="text" id="penalty-custom" placeholder="0x..." style="display:none; margin-top:0.5rem;" />
    <div class="warning" id="penalty-warning" style="display:none;"></div>

    <div class="actions-row">
      <button id="create-btn" class="primary" disabled>Connect wallet to create</button>
    </div>
  </div>

  <div id="withdraw-panel" class="panel" style="display:none;">
    <h2>Pending balance</h2>
    <p id="withdraw-amount"></p>
    <button id="withdraw-btn" class="primary">Withdraw</button>
  </div>

  <div class="panel">
    <h2 style="display:flex; justify-content:space-between; align-items:center;">
      Commitments
      <button id="refresh-btn">Refresh</button>
    </h2>
    <div id="commitments-list"><p class="empty-state">Connect a wallet to load commitments.</p></div>
  </div>

  <p class="footer-note">Built for the Spark hackathon on Monad. Referee mode: AI (default) or a named human referee. Failure fires automatically once the deadline plus grace window passes — no self-reporting required.</p>
`;

const templateRow = document.getElementById('template-row')!;
const descriptionInput = document.getElementById('description') as HTMLInputElement;
const deadlineInput = document.getElementById('deadline') as HTMLInputElement;
const stakeInput = document.getElementById('stake') as HTMLInputElement;
const stakeHint = document.getElementById('stake-hint')!;
const refereeInput = document.getElementById('referee') as HTMLInputElement;
const penaltyPreset = document.getElementById('penalty-preset') as HTMLSelectElement;
const penaltyCustom = document.getElementById('penalty-custom') as HTMLInputElement;
const penaltyWarning = document.getElementById('penalty-warning')!;
const createBtn = document.getElementById('create-btn') as HTMLButtonElement;
const connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
const networkBadge = document.getElementById('network-badge')!;
const addressPill = document.getElementById('address-pill')!;
const withdrawPanel = document.getElementById('withdraw-panel')!;
const withdrawAmount = document.getElementById('withdraw-amount')!;
const withdrawBtn = document.getElementById('withdraw-btn') as HTMLButtonElement;
const commitmentsList = document.getElementById('commitments-list')!;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;

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
  return d.toISOString().slice(0, 16);
}
deadlineInput.value = defaultDeadline();

penaltyPreset.addEventListener('change', () => {
  penaltyCustom.style.display = penaltyPreset.value === 'custom' ? 'block' : 'none';
  penaltyWarning.style.display = penaltyPreset.value === 'referee' ? 'block' : 'none';
  if (penaltyPreset.value === 'referee') {
    penaltyWarning.textContent =
      "Your referee profits if you fail — only pick this if you deeply trust them not to sandbag an honest success.";
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
  return (await state.publicClient!.readContract({
    address: state.network!.contractAddress!,
    abi: [{ type: 'function', name: 'treasury', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }],
    functionName: 'treasury',
  })) as Address;
}

async function connectWallet() {
  if (!window.ethereum) {
    alert('No wallet found. Install MetaMask or another injected wallet.');
    return;
  }
  state.walletClient = createWalletClient({ transport: custom(window.ethereum) });
  const [account] = await state.walletClient.requestAddresses();
  state.account = account;
  await syncChain();
  window.ethereum.on?.('accountsChanged', (accs: Address[]) => {
    state.account = accs[0] ?? null;
    render();
    refreshList();
  });
  window.ethereum.on?.('chainChanged', () => {
    syncChain().then(() => refreshList());
  });
  render();
  refreshList();
}

async function syncChain() {
  const chainIdHex: string = await window.ethereum.request({ method: 'eth_chainId' });
  state.chainId = parseInt(chainIdHex, 16);
  state.network = getNetworkConfig(state.chainId);
  state.publicClient = createPublicClient({ transport: custom(window.ethereum) }) as unknown as PublicClient;
  if (state.network?.contractAddress) {
    state.graceWindow = (await state.publicClient.readContract({
      address: state.network.contractAddress,
      abi: COMMITMENT_ABI,
      functionName: 'GRACE_WINDOW',
    })) as bigint;
  }
}

async function switchToLocalAnvil() {
  try {
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: '0x7a69',
          chainName: 'Local Anvil',
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['http://127.0.0.1:8545'],
        },
      ],
    });
  } catch (err) {
    console.error(err);
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

function render() {
  addressPill.textContent = state.account ? `${state.account.slice(0, 6)}...${state.account.slice(-4)}` : '';
  connectBtn.textContent = state.account ? 'Reconnect' : 'Connect Wallet';

  if (!state.chainId) {
    networkBadge.textContent = 'not connected';
    networkBadge.className = 'network-badge';
  } else if (state.network?.contractAddress) {
    networkBadge.textContent = state.network.name;
    networkBadge.className = 'network-badge';
  } else {
    networkBadge.textContent = `unsupported chain ${state.chainId}`;
    networkBadge.className = 'network-badge unsupported';
  }

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
  const description = descriptionInput.value.trim();
  if (!description) return alert('Describe what you are committing to.');

  const deadlineSeconds = BigInt(Math.floor(new Date(deadlineInput.value).getTime() / 1000));
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
    await state.publicClient!.waitForTransactionReceipt({ hash });
    descriptionInput.value = '';
    await refreshList();
  } catch (err: any) {
    alert(err.shortMessage || err.message || String(err));
  } finally {
    render();
  }
}

async function loadCommitments(): Promise<CommitmentEntry[]> {
  if (!state.publicClient || !state.network?.contractAddress) return [];
  const logs = await state.publicClient.getContractEvents({
    address: state.network.contractAddress,
    abi: COMMITMENT_ABI,
    eventName: 'CommitmentCreated',
    fromBlock: 0n,
    toBlock: 'latest',
  });
  return logs.map((log: any) => ({ id: log.args.id as bigint, description: log.args.description as string }));
}

function formatCountdown(deadline: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) return 'past deadline';
  const secs = Number(deadline - now);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m left`;
}

function renderCommitmentCard(entry: CommitmentEntry, stakeData: Stake): HTMLElement {
  const card = document.createElement('div');
  card.className = 'commitment-card';

  const isStaker = Boolean(state.account && stakeData.staker.toLowerCase() === state.account.toLowerCase());
  const now = BigInt(Math.floor(Date.now() / 1000));
  const graceOver = now > stakeData.deadline + state.graceWindow;
  const hasProof = stakeData.proofHash !== ZERO_HASH;
  const symbol = state.network?.currencySymbol ?? '';

  const statusLabel = stakeData.state === 1 ? 'resolved' : 'active';
  const statusClass = stakeData.state === 1 ? 'resolved-success' : 'active';

  card.innerHTML = `
    <div class="top-row">
      <span class="desc">#${entry.id} ${entry.description}</span>
      <span class="status-pill ${statusClass}">${statusLabel}</span>
    </div>
    <div class="meta-row">
      <span>staker ${stakeData.staker.slice(0, 6)}...${stakeData.staker.slice(-4)}</span>
      <span>${formatEther(stakeData.stakeAmount)} ${symbol} staked</span>
      <span>${stakeData.aiMode ? 'AI referee' : 'human referee'}</span>
      <span>${stakeData.state === 0 ? formatCountdown(stakeData.deadline) : ''}</span>
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
        await state.publicClient!.waitForTransactionReceipt({ hash });
        localStorage.setItem(`proof-${entry.id}`, text);
        await refreshList();
      } catch (err: any) {
        alert(err.shortMessage || err.message || String(err));
      }
    });
    actions.appendChild(textarea);
    actions.appendChild(submitBtn);
  }

  if (stakeData.state === 0 && hasProof) {
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
            proofUri: proofText,
            proofContent: proofText,
          }),
        });
        const data = await res.json();
        resultBox.className = `judge-result ${data.success ? 'pass' : 'fail'}`;
        resultBox.textContent = `${data.success ? 'PASS' : 'FAIL'} — ${data.reasoning}`;
        actions.appendChild(resultBox);
        if (data.success) {
          const confirmBtn = document.createElement('button');
          confirmBtn.className = 'primary';
          confirmBtn.textContent = 'Confirm Success On-Chain';
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
              await state.publicClient!.waitForTransactionReceipt({ hash });
              await refreshList();
            } catch (err: any) {
              alert(err.shortMessage || err.message || String(err));
            }
          });
          actions.appendChild(confirmBtn);
        }
      } catch (err: any) {
        resultBox.className = 'judge-result fail';
        resultBox.textContent = `Judge request failed: ${err.message || err}. Is the backend running?`;
        actions.appendChild(resultBox);
      } finally {
        judgeBtn.disabled = false;
        judgeBtn.textContent = 'Get AI Judgment';
      }
    });
    actions.appendChild(judgeBtn);
  }

  if (stakeData.state === 0 && graceOver) {
    const failBtn = document.createElement('button');
    failBtn.className = 'danger';
    failBtn.textContent = 'Execute Failure (permissionless)';
    failBtn.addEventListener('click', async () => {
      if (!state.account) return alert('Connect a wallet first — anyone can call this, but a wallet is needed to send the transaction.');
      try {
        failBtn.disabled = true;
        const hash = await state.walletClient!.writeContract({
          account: state.account,
          chain: null,
          address: state.network!.contractAddress!,
          abi: COMMITMENT_ABI,
          functionName: 'executeFailure',
          args: [entry.id],
        });
        await state.publicClient!.waitForTransactionReceipt({ hash });
        await refreshList();
      } catch (err: any) {
        alert(err.shortMessage || err.message || String(err));
      }
    });
    actions.appendChild(failBtn);
  }

  card.appendChild(actions);
  return card;
}

async function refreshList() {
  if (!state.publicClient || !state.network?.contractAddress) {
    commitmentsList.innerHTML = '<p class="empty-state">Connect a wallet to load commitments.</p>';
    return;
  }
  const entries = await loadCommitments();
  if (entries.length === 0) {
    commitmentsList.innerHTML = '<p class="empty-state">No commitments yet. Be the first.</p>';
  } else {
    commitmentsList.innerHTML = '';
    for (const entry of entries.slice().reverse()) {
      const stakeData = (await state.publicClient.readContract({
        address: state.network.contractAddress,
        abi: COMMITMENT_ABI,
        functionName: 'getStake',
        args: [entry.id],
      })) as Stake;
      commitmentsList.appendChild(renderCommitmentCard(entry, stakeData));
    }
  }

  if (state.account) {
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
    await state.publicClient!.waitForTransactionReceipt({ hash });
    await refreshList();
  } catch (err: any) {
    alert(err.shortMessage || err.message || String(err));
  } finally {
    withdrawBtn.disabled = false;
  }
});

connectBtn.addEventListener('click', connectWallet);
createBtn.addEventListener('click', createCommitment);
refreshBtn.addEventListener('click', refreshList);

// Quick network-switch helpers, surfaced only when relevant.
const switchRow = document.createElement('div');
switchRow.style.marginTop = '0.5rem';
switchRow.style.display = 'flex';
switchRow.style.gap = '0.5rem';
const localBtn = document.createElement('button');
localBtn.textContent = 'Use Local Anvil';
localBtn.addEventListener('click', switchToLocalAnvil);
const testnetBtn = document.createElement('button');
testnetBtn.textContent = 'Use Monad Testnet';
testnetBtn.addEventListener('click', switchToMonadTestnet);
switchRow.appendChild(localBtn);
switchRow.appendChild(testnetBtn);
document.querySelector('.wallet-bar')!.after(switchRow);

render();

console.log('Networks configured:', Object.values(NETWORKS).map((n) => n.name));
