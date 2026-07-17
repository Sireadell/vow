// Minimal ABI slice — only what the backend needs to read events and call
// confirmSuccess. Kept hand-written and committed (rather than pulled from
// contracts/out/, which is a gitignored build artifact) so this file is
// reviewable without running forge build first.
export const COMMITMENT_ABI = [
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
    name: 'ProofSubmitted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'uri', type: 'string', indexed: false },
      { name: 'proofHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Resolved',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'success', type: 'bool', indexed: false },
      { name: 'resolver', type: 'address', indexed: true },
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
];
