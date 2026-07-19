// An RPC endpoint used for scanning event logs, with the widest
// eth_getLogs block span (toBlock - fromBlock) it accepts. Public Monad
// testnet RPCs each cap this differently, so the span is configured per
// endpoint, held slightly under the measured limit for safety margin.
export interface LogScanRpc {
  url: string;
  maxSpan: bigint;
}

export interface NetworkConfig {
  name: string;
  contractAddress: `0x${string}` | null;
  backendUrl: string;
  explorerUrl: string | null;
  rpcUrl: string;
  currencySymbol: string;
  // First block to scan for event logs. Monad testnet's public RPC rejects
  // getLogs queries spanning too wide a block range, so scanning from 0 on a
  // chain with a long history 400s — start from the contract's own deploy
  // block instead. Anvil is a fresh chain each run, so 0 is fine there.
  deployBlock: bigint;
  // Endpoints tried in order for event-log scanning. Hit directly over HTTP
  // (not through the wallet's injected provider) so chunked scans aren't
  // subject to whatever unknown RPC the user's wallet routes to.
  logScanRpcs: LogScanRpc[];
}

// Only Monad testnet is supported now that the real contract is deployed
// there — any other chain (including a leftover local Anvil connection from
// earlier dev testing) is treated as unsupported so connectWallet() auto-
// switches the wallet to testnet instead of silently accepting it.
export const NETWORKS: Record<number, NetworkConfig> = {
  10143: {
    name: 'Monad Testnet',
    contractAddress: '0xB0A6AAdD39b8760213474151bd55BdeB7542d8Fc',
    backendUrl: 'https://vow-backend-xh1t.onrender.com',
    explorerUrl: 'https://testnet.monadexplorer.com',
    rpcUrl: 'https://testnet-rpc.monad.xyz/',
    currencySymbol: 'MON',
    deployBlock: 45993133n,
    logScanRpcs: [
      // Measured live 2026-07-18: drpc accepts spans up to 1000 blocks
      // (1001 → "block range too large"), 10x the official RPC's cap.
      { url: 'https://monad-testnet.drpc.org', maxSpan: 998n },
      // Measured live 2026-07-18: official RPC accepts spans up to 100
      // blocks (101 → -32614 "eth_getLogs is limited to a 100 range").
      { url: 'https://testnet-rpc.monad.xyz/', maxSpan: 98n },
    ],
  },
};

export function getNetworkConfig(chainId: number): NetworkConfig | undefined {
  return NETWORKS[chainId];
}
