# Dogfood stake runbook

Stake real testnet MON on shipping this exact submission by the hackathon deadline. This is meant to be run by you, in your own terminal, with your own wallet. It is not automated and does not touch your keys in any file or shell history.

Do this once the contract is actually deployed to Monad testnet (still blocked on the deploy wallet funding issue as of the last check).

## 1. Import your wallet into Foundry's keystore

This prompts for your private key and a password interactively. Neither ever touches a file, shell history, or this repo.

```
cast wallet import dogfood --interactive
```

You will be asked for the private key once, and a password to encrypt it locally. From then on you unlock it with the password, not the key.

## 2. Fill in the contract address

Once `contracts/.env` has a real `COMMITMENT_CONTRACT_ADDRESS` (after the testnet deploy), copy it here:

```
CONTRACT=<paste testnet contract address>
RPC=https://testnet-rpc.monad.xyz/
```

## 3. Choose your penalty destination

Per the README, options are treasury, a burn address, a custom address (a cause you would hate funding is the most viral choice), or your referee's own address (not recommended for AI mode, since there is no human referee to warn).

For the dogfood stake specifically, the anti-charity option was flagged as the strongest lever for the viral prize. Pick one and set it:

```
PENALTY_RECIPIENT=<address you choose>
```

## 4. Set the deadline

The hackathon deadline is July 19 2026, 23:59 UTC. Convert to a unix timestamp and use something before that, with margin for actually finishing the submission:

```
DEADLINE=<unix timestamp, before July 19 2026 23:59 UTC>
```

## 5. Send the stake

Pick a stake amount you are actually willing to lose publicly. AI referee mode (blank referee address):

```
cast send $CONTRACT "createCommitment(string,uint256,address,address)" \
  "Ship the Spark hackathon submission (Ship-It Stake) by the deadline" \
  $DEADLINE \
  0x0000000000000000000000000000000000000000 \
  $PENALTY_RECIPIENT \
  --value 0.05ether \
  --account dogfood \
  --rpc-url $RPC
```

Confirm the password prompt to sign and send. Note the transaction hash and the commitment id from the emitted `CommitmentCreated` event, both go in the submission.

## 6. Do this early, not near the deadline

The point of this is that the stake transaction predates the rest of the build, which is part of the proof this was not pre-written. Do this as close to the start of your remaining work as you can, not as a last-minute flourish.

## 7. Let it resolve for real

Either submit real proof and get it confirmed before the deadline, or let it lapse and let `executeFailure` fire for real. Either outcome, screenshot or record it. That resolution, success or the actual public failure, is the strongest material for the submission and for the viral prize.
