# Spark submission

## Project name

Vow

## One line description

Stake real money on a personal commitment. Succeed and get it back. Fail, even by staying silent, and it moves, automatically, to a destination you chose up front.

## The problem (personal, not technical)

People say they will do something and then they do not, because nothing actually enforces it. Every accountability app has the same hole: the naive version needs you to report your own failure, and nobody ever does that. This app closes that hole. Once the deadline passes, anyone, not just you, can trigger the failure and move the money. Silence never lets you off the hook.

## The solution

A staking contract on Monad. You describe a commitment, set a deadline, pick a referee (a friend, or an AI that reviews your proof), and choose where the stake goes if you fail: a treasury, a burn address, a charity, an anti charity you would hate funding, whatever actually motivates you. Submit proof before the deadline and get confirmed, or do nothing and watch the deadline plus a short grace window pass, at which point anyone can permissionlessly trigger the failure and collect a small reward for doing so.

This submission itself was staked the same way: [dogfood transaction hash / commitment id, once real].

## What is genuinely working, not just planned

- A tested Solidity contract (25 Foundry tests, every state transition covered), independently reviewed for security before any real stake touched it
- A backend AI referee that reads submitted proof and signs an onchain confirmation only if the proof text actually matches what was committed onchain, closing a real bypass that was found and fixed before deploy
- A working frontend: connect a wallet, create a commitment, submit proof, get judged, confirm success or trigger failure
- End to end verified: both the success path and the permissionless failure path, with correct payouts, confirmed live onchain

## Links

- Contract address (Monad testnet): `0xB0A6AAdD39b8760213474151bd55BdeB7542d8Fc`
- Repo: `https://github.com/Sireadell/vow`
- Live app: `https://tryvow.vercel.app`
- Demo video: `[fill in]`
- Social post: `[fill in]`

## Disclosed limitations, not hidden

- The AI referee is a single signing key today, not a decentralized oracle. Disclosed in full in the README, including the actual blast radius of a compromised key.
- A pooled, multi person version of this was scoped out on purpose for the time available, noted as a real next step, not something half built.
