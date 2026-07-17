// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Commitment} from "../src/Commitment.sol";

contract Deploy is Script {
    function run() external returns (Commitment) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address attesterSigner = vm.envAddress("ATTESTER_SIGNER_ADDRESS");

        vm.startBroadcast(deployerKey);
        Commitment c = new Commitment(
            1 hours, // MIN_DURATION
            30 days, // MAX_DURATION
            1 hours, // GRACE_WINDOW
            0.01 ether, // MIN_STAKE (MON has 18 decimals, same as ETH)
            1 ether, // MAX_STAKE_AI
            0.001 ether, // PROTOCOL_FEE
            0.0005 ether, // KEEPER_BOUNTY
            0.0005 ether, // REFEREE_FEE
            treasury,
            attesterSigner
        );
        vm.stopBroadcast();
        return c;
    }
}
