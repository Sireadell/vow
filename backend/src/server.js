import cors from 'cors';
import express from 'express';
import { createPublicClient, http, keccak256, toHex } from 'viem';
import { COMMITMENT_ABI } from './abi.js';
import { config } from './config.js';
import { createJudge } from './judge.js';
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
    return res.status(400).json({ error: 'id, description, and proofText are required' });
  }

  try {
    const stake = await publicClient.readContract({
      address: config.contractAddress,
      abi: COMMITMENT_ABI,
      functionName: 'getStake',
      args: [BigInt(id)],
    });

    if (stake.state !== 0) {
      return res.status(400).json({ error: 'commitment is not Active' });
    }
    if (!stake.aiMode) {
      return res.status(400).json({ error: 'commitment does not use the AI referee' });
    }

    const proofHash = keccak256(toHex(proofText));
    if (proofHash !== stake.proofHash) {
      return res
        .status(400)
        .json({ error: 'proofText does not match the proof hash submitted on-chain for this commitment' });
    }

    const verdict = await judge.judge({ description, proofContent: proofText });
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
