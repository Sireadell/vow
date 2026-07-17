import { createPublicClient, http } from 'viem';
import { config } from './config.js';
import { COMMITMENT_ABI } from './abi.js';
import { createJudge } from './judge.js';

const client = createPublicClient({ transport: http(config.rpcUrl) });
const judge = createJudge();

// id -> description, so a ProofSubmitted event can be judged without a
// separate description getter on-chain (description is emitted, not stored).
const descriptions = new Map();

console.log(`Watching Commitment at ${config.contractAddress} on ${config.network}...`);

client.watchContractEvent({
  address: config.contractAddress,
  abi: COMMITMENT_ABI,
  eventName: 'CommitmentCreated',
  onLogs: (logs) => {
    for (const log of logs) {
      descriptions.set(log.args.id.toString(), log.args.description);
      console.log(`[CommitmentCreated] id=${log.args.id} staker=${log.args.staker} description="${log.args.description}"`);
    }
  },
});

client.watchContractEvent({
  address: config.contractAddress,
  abi: COMMITMENT_ABI,
  eventName: 'ProofSubmitted',
  onLogs: async (logs) => {
    for (const log of logs) {
      const id = log.args.id.toString();
      const description = descriptions.get(id) || '(description unknown — commitment created before this watcher started)';
      console.log(`[ProofSubmitted] id=${id} uri="${log.args.uri}" — judging...`);
      try {
        const verdict = await judge.judge({ description, proofContent: log.args.uri });
        console.log(`[Judged] id=${id} success=${verdict.success} reasoning="${verdict.reasoning}"`);
      } catch (err) {
        console.error(`[Judged] id=${id} error:`, err.message || err);
      }
    }
  },
});

client.watchContractEvent({
  address: config.contractAddress,
  abi: COMMITMENT_ABI,
  eventName: 'Failed',
  onLogs: (logs) => {
    for (const log of logs) {
      console.log(`\n[FAILED] id=${log.args.id} staker=${log.args.staker}`);
      console.log('Shame post reminder — post this manually (no auto-posting infra by design):');
      console.log(`  "Commitment #${log.args.id} failed. The stake has moved to the chosen penalty recipient. No excuses, no snooze."\n`);
    }
  },
});
