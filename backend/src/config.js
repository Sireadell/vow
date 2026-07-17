import 'dotenv/config';

const network = process.env.NETWORK || 'local';

const isLocal = network === 'local';

export const config = {
  network,
  rpcUrl: isLocal ? process.env.LOCAL_RPC_URL : process.env.MONAD_TESTNET_RPC_URL,
  contractAddress: isLocal
    ? process.env.LOCAL_COMMITMENT_CONTRACT_ADDRESS
    : process.env.COMMITMENT_CONTRACT_ADDRESS,
  chainId: isLocal ? 31337 : 10143,
  attesterPrivateKey: process.env.ATTESTER_SIGNER_PRIVATE_KEY,
  port: process.env.PORT || 3001,
};

if (!config.contractAddress) {
  throw new Error(
    `No contract address configured for network "${network}". Set LOCAL_COMMITMENT_CONTRACT_ADDRESS or COMMITMENT_CONTRACT_ADDRESS in backend/.env.`
  );
}
