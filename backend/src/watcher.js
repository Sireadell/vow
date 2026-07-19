import { createPublicClient, http } from 'viem';
import { config } from './config.js';
import { COMMITMENT_ABI } from './abi.js';
import { createJudge } from './judge.js';

const client = createPublicClient({ transport: http(config.rpcUrl) });
const judge = createJudge();

// id -> description, so a ProofSubmitted event can be judged without a
// separate description getter on-chain (description is emitted, not stored).
const descriptions = new Map();

// Why a manual polling loop instead of viem's watchContractEvent:
// Monad testnet's public RPC does not support eth_newFilter (measured live:
// -32601 Method not found), so watchContractEvent falls back to polling
// eth_getLogs from the last seen block to the head in a SINGLE call. The
// same RPC caps eth_getLogs at a 100-block span (measured live: spans over
// 100 → -32614 "eth_getLogs is limited to a 100 range"), and Monad produces
// a block roughly every half second — so any poll gap over ~50s (network
// blip, laptop sleep, event-loop stall) makes that one call exceed the cap.
// Worse, viem only advances its internal cursor AFTER a successful fetch,
// so once the gap exceeds the cap every later poll fails too, forever, and
// with no onError handler the failure is completely silent.
//
// This loop instead drains the backlog in spans the RPC always accepts and
// only advances the cursor past ranges that were actually fetched, so a
// stall of any length is caught up 99 blocks at a time and a transient RPC
// error just retries the same bounded span on the next tick.
const MAX_SPAN = 98n; // to - from; measured cap is 100, held under for margin
const POLL_MS = 2000;

const WATCHED_EVENTS = COMMITMENT_ABI.filter(
  (item) => item.type === 'event' && ['CommitmentCreated', 'ProofSubmitted', 'Failed'].includes(item.name)
);

async function handleLog(log) {
  switch (log.eventName) {
    case 'CommitmentCreated': {
      descriptions.set(log.args.id.toString(), log.args.description);
      console.log(
        `[CommitmentCreated] id=${log.args.id} staker=${log.args.staker} description="${log.args.description}"`
      );
      break;
    }
    case 'ProofSubmitted': {
      const id = log.args.id.toString();
      const description =
        descriptions.get(id) || '(description unknown — commitment created before this watcher started)';
      console.log(`[ProofSubmitted] id=${id} uri="${log.args.uri}" — judging...`);
      try {
        const verdict = await judge.judge({ description, proofContent: log.args.uri });
        console.log(`[Judged] id=${id} success=${verdict.success} reasoning="${verdict.reasoning}"`);
      } catch (err) {
        console.error(`[Judged] id=${id} error:`, err.message || err);
      }
      break;
    }
    case 'Failed': {
      console.log(`\n[FAILED] id=${log.args.id} staker=${log.args.staker}`);
      console.log('Shame post reminder — post this manually (no auto-posting infra by design):');
      console.log(
        `  "Commitment #${log.args.id} failed. The stake has moved to the chosen penalty recipient. No excuses, no snooze."\n`
      );
      break;
    }
  }
}

// Last block already scanned; null until the first tick sets the baseline
// (only events from startup onward are watched, same as before).
let cursor = null;

async function pollOnce() {
  const head = await client.getBlockNumber();
  if (cursor === null) {
    cursor = head;
    return;
  }
  while (cursor < head) {
    const from = cursor + 1n;
    const to = from + MAX_SPAN < head ? from + MAX_SPAN : head;
    const logs = await client.getLogs({
      address: config.contractAddress,
      events: WATCHED_EVENTS,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      await handleLog(log);
    }
    cursor = to;
  }
}

console.log(`Watching Commitment at ${config.contractAddress} on ${config.network}...`);

for (;;) {
  try {
    await pollOnce();
  } catch (err) {
    console.error('[watcher] poll error (will retry):', err.message || err);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
