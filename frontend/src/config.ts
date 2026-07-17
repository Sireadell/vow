export interface NetworkConfig {
  name: string;
  contractAddress: `0x${string}` | null;
  backendUrl: string;
  explorerUrl: string | null;
  rpcUrl: string;
  currencySymbol: string;
}

// Deployed local Anvil address is filled in for dev; the testnet address
// gets filled in once the real deploy lands (see contracts/.env).
export const NETWORKS: Record<number, NetworkConfig> = {
  31337: {
    name: 'Local (Anvil)',
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    backendUrl: 'http://localhost:3001',
    explorerUrl: null,
    rpcUrl: 'http://127.0.0.1:8545',
    currencySymbol: 'ETH',
  },
  10143: {
    name: 'Monad Testnet',
    contractAddress: null,
    backendUrl: 'http://localhost:3001',
    explorerUrl: 'https://testnet.monadexplorer.com',
    rpcUrl: 'https://testnet-rpc.monad.xyz/',
    currencySymbol: 'MON',
  },
};

export function getNetworkConfig(chainId: number): NetworkConfig | undefined {
  return NETWORKS[chainId];
}
