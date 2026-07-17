import { privateKeyToAccount } from 'viem/accounts';

const DOMAIN_NAME = 'CommitmentStake';
const DOMAIN_VERSION = '1';

const TYPES = {
  ConfirmSuccess: [
    { name: 'id', type: 'uint256' },
    { name: 'proofHash', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
  ],
};

export function createAttester({ privateKey, chainId, contractAddress }) {
  const account = privateKeyToAccount(privateKey);

  return {
    address: account.address,
    async signConfirmSuccess({ id, proofHash, expirySeconds = 3600 }) {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);
      const signature = await account.signTypedData({
        domain: {
          name: DOMAIN_NAME,
          version: DOMAIN_VERSION,
          chainId,
          verifyingContract: contractAddress,
        },
        types: TYPES,
        primaryType: 'ConfirmSuccess',
        message: { id: BigInt(id), proofHash, expiry },
      });
      return { signature, expiry: expiry.toString() };
    },
  };
}
