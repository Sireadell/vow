# Ship It Stake

A commitment stake app built for the Spark hackathon on Monad.

## The problem

People say they will do something (ship a feature, quit a habit, wake up on time) and then they do not, because nothing actually enforces it. Most "accountability" tools are worthless because the naive version needs the person to report their own failure, and nobody ever does that. This app fixes that: failure fires automatically once a deadline passes, and anyone can trigger it, so silence never lets someone off the hook.

## How it works

You stake real money on a commitment. Succeed and prove it, and you get the stake back. Fail, including by simply doing nothing, and the stake moves to a destination you chose when you made the commitment, and it happens with or without your cooperation.

1. Create a commitment: describe what you are staking on, set a deadline, choose a referee (a named person, or leave it blank for an AI referee), and pick where the money goes if you fail.
2. Submit proof before the deadline.
3. The referee confirms success, either a human you named or an AI judge that reviews the proof and signs off onchain.
4. If nothing is confirmed by the deadline plus a short grace window, anyone can call the failure function and the stake moves. There is a small reward for whoever triggers it, so someone always has a reason to.

## Where the stake goes on failure

Chosen at creation time, not after the fact:

- Treasury, the safe default
- A burn address, gone forever
- Any custom address you choose, a charity, a cause you would hate funding, a friend, whatever holds you accountable
- Your referee's own address, flagged with an explicit warning since it gives the referee a reason to withhold an honest success

## Design choices, disclosed rather than hidden

- The AI referee is a single signing key today, not a decentralized oracle. A compromised key could let someone falsely confirm their own commitment early, but it cannot touch anyone else's stake.
- A named human referee is trusted only to not falsely approve a failure as a success. Falsely reporting failure has no upside for the referee, since the referee's fee is the same either way, except in the one case where the staker names the referee as the failure destination too, which is why that option carries an explicit warning.
- A pooled, multi person version of this ("Group Flake Stake") was scoped out on purpose. It needs a different contract shape and was not worth the risk in the time available. Noted here as a real idea for later, not something half built.

## Repo layout

- `contracts/`: the Commitment contract, written and tested with Foundry (24 tests, all state transitions covered)
- `backend/`: the AI referee. Reads submitted proof, judges it, and signs an onchain confirmation if it passes. Also watches the contract for failures.
- `frontend/`: the web app. Connect a wallet, create a commitment, submit proof, get it judged, and confirm success or trigger failure

## Running it locally

Contracts:

```
cd contracts
forge test
```

Backend:

```
cd backend
npm install
cp .env.example .env   # fill in RPC url, contract address, attester key
npm start
```

Frontend:

```
cd frontend
npm install
npm run dev
```

The frontend auto detects whether your wallet is on the local Anvil test chain or Monad testnet and points at the right contract for each.

## What is next, not built yet

- The pooled multi person version noted above
- A real dispute process for the human referee path. Today a disagreement is resolved socially, not onchain, and that is disclosed rather than pretended away
