import cors from 'cors';
import express from 'express';
import { createPublicClient, http, keccak256, toHex } from 'viem';
import { COMMITMENT_ABI } from './abi.js';
import { config } from './config.js';
import { createJudge } from './judge.js';
import { enrichProofContent } from './linkVerify.js';
import { createAttester } from './signer.js';

const app = express();
app.use(cors());
app.use(express.json());

const judge = createJudge();
const attester = createAttester({
  privateKey: config.attesterPrivateKey,
  chainId: config.chainId,
  contractAddress: config.contractAddress,
});
const publicClient = createPublicClient({ transport: http(config.rpcUrl) });

app.get('/health', (req, res) => {
  res.json({ status: 'ok', network: config.network, attester: attester.address });
});

// Judges the proof text that was actually bound on-chain by submitProof, and
// signs the hash of that exact text. Both the judge input and the signed
// hash MUST be derived from the same on-chain proofHash — otherwise someone
// could submit garbage on-chain, then get a convincing fabricated proof
// judged and signed separately, and confirmSuccess would still accept it
// since the contract only checks the hash matches, not what was judged.
app.post('/judge', async (req, res) => {
  const { id, description, proofText } = req.body;
  if (id === undefined || !description || !proofText) {
    return res.status(400).json({ error: 'Something was missing from the request. Refresh the page and try again.' });
  }

  try {
    const stake = await publicClient.readContract({
      address: config.contractAddress,
      abi: COMMITMENT_ABI,
      functionName: 'getStake',
      args: [BigInt(id)],
    });

    if (stake.state !== 0) {
      return res.status(400).json({ error: "This commitment has already been resolved, so it can't be judged again." });
    }
    if (!stake.aiMode) {
      return res
        .status(400)
        .json({ error: 'This commitment uses a human referee, not the AI. Ask your referee to confirm it instead.' });
    }

    const proofHash = keccak256(toHex(proofText));
    if (proofHash !== stake.proofHash) {
      return res.status(400).json({
        error:
          "This text doesn't match what you last submitted onchain. Use \"Submit Different Proof\" to update it, then try judging again.",
      });
    }

    // Enrich once, upstream of the judge, so any URL in the proof gets
    // actually fetched and verified by the server (GitHub API for repo
    // links, guarded plain GET otherwise) no matter which provider judges.
    // Never throws — failures degrade into explicit notes in the prompt.
    const enrichedProof = await enrichProofContent(proofText);
    const verdict = await judge.judge({ description, proofContent: enrichedProof });
    if (!verdict.success) {
      return res.json({ success: false, reasoning: verdict.reasoning });
    }

    const { signature, expiry } = await attester.signConfirmSuccess({ id, proofHash });
    return res.json({ success: true, reasoning: verdict.reasoning, id, proofHash, expiry, signature });
  } catch (err) {
    console.error('judge error:', err);
    return res.status(500).json({ error: 'judge failed', detail: String(err.message || err) });
  }
});

app.listen(config.port, () => {
  console.log(`Commitment backend listening on :${config.port} (network: ${config.network})`);
  console.log(`Attester address: ${attester.address}`);
  console.log(`Contract: ${config.contractAddress}`);
});
