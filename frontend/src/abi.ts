// Minimal ABI slice used by the frontend. Hand-written and committed
// (contracts/out/ is a gitignored build artifact) so it's reviewable
// without running forge build first. Mirrors backend/src/abi.js.
export const COMMITMENT_ABI = [
  {
    type: 'function',
    name: 'createCommitment',
    stateMutability: 'payable',
    inputs: [
      { name: 'description', type: 'string' },
      { name: 'deadline', type: 'uint256' },
      { name: 'referee', type: 'address' },
      { name: 'penaltyRecipient', type: 'address' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'submitProof',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'confirmSuccess',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeFailure',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balances',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'GRACE_WINDOW',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getStake',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'staker', type: 'address' },
          { name: 'referee', type: 'address' },
          { name: 'penaltyRecipient', type: 'address' },
          { name: 'stakeAmount', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'aiMode', type: 'bool' },
          { name: 'state', type: 'uint8' },
          { name: 'proofHash', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'CommitmentCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'staker', type: 'address', indexed: true },
      { name: 'referee', type: 'address', indexed: false },
      { name: 'penaltyRecipient', type: 'address', indexed: false },
      { name: 'stakeAmount', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
      { name: 'aiMode', type: 'bool', indexed: false },
      { name: 'description', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Failed',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'staker', type: 'address', indexed: true },
      { name: 'proofHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;
