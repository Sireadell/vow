import express from 'express';
import { keccak256, toHex } from 'viem';
import { config } from './config.js';
import { createJudge } from './judge.js';
import { createAttester } from './signer.js';

const app = express();
app.use(express.json());

const judge = createJudge();
const attester = createAttester({
  privateKey: config.attesterPrivateKey,
  chainId: config.chainId,
  contractAddress: config.contractAddress,
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', network: config.network, attester: attester.address });
});

// Judges a submitted proof against the commitment description. On a pass,
// signs an EIP712 attestation that anyone can submit to confirmSuccess —
// this endpoint never touches chain state itself, it only signs.
app.post('/judge', async (req, res) => {
  const { id, description, proofUri, proofContent } = req.body;
  if (id === undefined || !description || !proofContent) {
    return res.status(400).json({ error: 'id, description, and proofContent are required' });
  }

  try {
    const verdict = await judge.judge({ description, proofContent });
    const proofHash = keccak256(toHex(proofUri || proofContent));

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
