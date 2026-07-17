// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Commitment} from "../src/Commitment.sol";

contract CommitmentTest is Test {
    Commitment c;

    address treasury = address(0xFEE5);
    address staker = address(0xA11CE);
    address referee = address(0xB0B);
    address charity = address(0xCAA5E);
    uint256 attesterPk = 0xA11E5;
    address attester;

    uint256 constant MIN_DURATION = 1 hours;
    uint256 constant MAX_DURATION = 30 days;
    uint256 constant GRACE_WINDOW = 1 hours;
    uint256 constant MIN_STAKE = 0.01 ether;
    uint256 constant MAX_STAKE_AI = 1 ether;
    uint256 constant PROTOCOL_FEE = 0.001 ether;
    uint256 constant KEEPER_BOUNTY = 0.0005 ether;
    uint256 constant REFEREE_FEE = 0.0005 ether;

    function setUp() public {
        attester = vm.addr(attesterPk);
        c = new Commitment(
            MIN_DURATION,
            MAX_DURATION,
            GRACE_WINDOW,
            MIN_STAKE,
            MAX_STAKE_AI,
            PROTOCOL_FEE,
            KEEPER_BOUNTY,
            REFEREE_FEE,
            treasury,
            attester
        );
        vm.deal(staker, 10 ether);
        vm.deal(referee, 1 ether);
    }

    function _create(address _referee, address _penaltyRecipient, uint256 stakeAmount)
        internal
        returns (uint256 id)
    {
        vm.prank(staker);
        id = c.createCommitment{value: stakeAmount + PROTOCOL_FEE}(
            "ship the thing", block.timestamp + 1 days, _referee, _penaltyRecipient
        );
    }

    function test_createCommitment_humanMode_happyPath() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        Commitment.Stake memory s = c.getStake(id);
        assertEq(s.staker, staker);
        assertEq(s.referee, referee);
        assertEq(s.penaltyRecipient, charity);
        assertEq(s.stakeAmount, 0.1 ether);
        assertFalse(s.aiMode);
        assertEq(uint256(s.state), uint256(Commitment.State.Active));
        assertEq(c.totalEscrowed(), 0.1 ether);
        assertEq(c.balances(treasury), PROTOCOL_FEE);
    }

    function test_createCommitment_aiMode_happyPath() public {
        uint256 id = _create(address(0), charity, 0.1 ether);
        Commitment.Stake memory s = c.getStake(id);
        assertTrue(s.aiMode);
        assertEq(s.referee, address(0));
    }

    function test_createCommitment_revertsWhenRefereeIsStaker() public {
        vm.prank(staker);
        vm.expectRevert(Commitment.InvalidReferee.selector);
        c.createCommitment{value: 0.1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 1 days, staker, charity
        );
    }

    function test_createCommitment_revertsWhenPenaltyRecipientIsStaker() public {
        vm.prank(staker);
        vm.expectRevert(Commitment.InvalidPenaltyRecipient.selector);
        c.createCommitment{value: 0.1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 1 days, referee, staker
        );
    }

    function test_createCommitment_revertsWhenPenaltyRecipientIsZeroAddress() public {
        vm.prank(staker);
        vm.expectRevert(Commitment.InvalidPenaltyRecipient.selector);
        c.createCommitment{value: 0.1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 1 days, referee, address(0)
        );
    }

    function test_createCommitment_revertsOnBadDuration() public {
        vm.startPrank(staker);
        vm.expectRevert(Commitment.InvalidDuration.selector);
        c.createCommitment{value: 0.1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 1 minutes, referee, charity
        );

        vm.expectRevert(Commitment.InvalidDuration.selector);
        c.createCommitment{value: 0.1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 60 days, referee, charity
        );
        vm.stopPrank();
    }

    function test_createCommitment_revertsOnInsufficientStake() public {
        vm.prank(staker);
        vm.expectRevert(Commitment.InsufficientStake.selector);
        c.createCommitment{value: PROTOCOL_FEE}(
            "x", block.timestamp + 1 days, referee, charity
        );
    }

    function test_createCommitment_revertsOnStakeTooHighForAi() public {
        vm.prank(staker);
        vm.expectRevert(Commitment.StakeTooHighForAi.selector);
        c.createCommitment{value: MAX_STAKE_AI + 1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 1 days, address(0), charity
        );
    }

    function test_createCommitment_revertsWhenPaused() public {
        vm.prank(treasury);
        c.setPaused(true);
        vm.prank(staker);
        vm.expectRevert(Commitment.Paused.selector);
        c.createCommitment{value: 0.1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 1 days, referee, charity
        );
    }

    function test_createCommitment_revertsWhenAiPaused() public {
        vm.prank(treasury);
        c.setAiPaused(true);
        vm.prank(staker);
        vm.expectRevert(Commitment.AiPaused.selector);
        c.createCommitment{value: 0.1 ether + PROTOCOL_FEE}(
            "x", block.timestamp + 1 days, address(0), charity
        );
    }

    function test_submitProof_storesHashAndEmitsUri() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        vm.prank(staker);
        c.submitProof(id, "ipfs://proof");
        Commitment.Stake memory s = c.getStake(id);
        assertEq(s.proofHash, keccak256(bytes("ipfs://proof")));
    }

    function test_submitProof_revertsForNonStaker() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        vm.prank(referee);
        vm.expectRevert(Commitment.NotStaker.selector);
        c.submitProof(id, "ipfs://proof");
    }

    function test_confirmSuccess_humanMode_paysStakerAndReferee() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        vm.prank(referee);
        c.confirmSuccess(id, 0, "");

        assertEq(c.balances(staker), 0.1 ether - REFEREE_FEE);
        assertEq(c.balances(referee), REFEREE_FEE);
        assertEq(c.totalEscrowed(), 0);
        Commitment.Stake memory s = c.getStake(id);
        assertEq(uint256(s.state), uint256(Commitment.State.Resolved));
    }

    function test_confirmSuccess_humanMode_revertsForNonReferee() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        vm.prank(staker);
        vm.expectRevert(Commitment.NotReferee.selector);
        c.confirmSuccess(id, 0, "");
    }

    function test_confirmSuccess_aiMode_validSignature_paysFullStake() public {
        uint256 id = _create(address(0), charity, 0.1 ether);
        vm.prank(staker);
        c.submitProof(id, "ipfs://proof");
        Commitment.Stake memory s = c.getStake(id);

        uint256 expiry = block.timestamp + 1 hours;
        bytes32 digest = _confirmDigest(id, s.proofHash, expiry);
        (uint8 v, bytes32 r, bytes32 sSig) = vm.sign(attesterPk, digest);
        bytes memory sig = abi.encodePacked(r, sSig, v);

        address rando = address(0xD00D);
        vm.prank(rando);
        c.confirmSuccess(id, expiry, sig);

        assertEq(c.balances(staker), 0.1 ether);
    }

    function test_confirmSuccess_aiMode_revertsOnBadSignature() public {
        uint256 id = _create(address(0), charity, 0.1 ether);
        Commitment.Stake memory s = c.getStake(id);
        uint256 expiry = block.timestamp + 1 hours;
        bytes32 digest = _confirmDigest(id, s.proofHash, expiry);

        uint256 wrongPk = 0xBADBAD;
        (uint8 v, bytes32 r, bytes32 sSig) = vm.sign(wrongPk, digest);
        bytes memory sig = abi.encodePacked(r, sSig, v);

        vm.expectRevert(Commitment.InvalidSignature.selector);
        c.confirmSuccess(id, expiry, sig);
    }

    function test_confirmSuccess_revertsAfterGraceWindow() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        Commitment.Stake memory s = c.getStake(id);
        vm.warp(s.deadline + GRACE_WINDOW + 1);
        vm.prank(referee);
        vm.expectRevert(Commitment.GraceWindowPassed.selector);
        c.confirmSuccess(id, 0, "");
    }

    function test_executeFailure_revertsBeforeGraceWindowPasses() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        vm.expectRevert(Commitment.GraceWindowNotPassed.selector);
        c.executeFailure(id);
    }

    function test_executeFailure_paysKeeperRefereeAndPenaltyRecipient() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        Commitment.Stake memory s = c.getStake(id);
        vm.warp(s.deadline + GRACE_WINDOW + 1);

        address keeper = address(0xCAFE);
        vm.prank(keeper);
        c.executeFailure(id);

        assertEq(c.balances(keeper), KEEPER_BOUNTY);
        assertEq(c.balances(referee), REFEREE_FEE);
        assertEq(c.balances(charity), 0.1 ether - KEEPER_BOUNTY - REFEREE_FEE);
        assertEq(c.totalEscrowed(), 0);
    }

    function test_executeFailure_aiMode_noRefereeFee() public {
        uint256 id = _create(address(0), charity, 0.1 ether);
        Commitment.Stake memory s = c.getStake(id);
        vm.warp(s.deadline + GRACE_WINDOW + 1);

        address keeper = address(0xCAFE);
        vm.prank(keeper);
        c.executeFailure(id);

        assertEq(c.balances(keeper), KEEPER_BOUNTY);
        assertEq(c.balances(charity), 0.1 ether - KEEPER_BOUNTY);
    }

    function test_executeFailure_revertsIfAlreadyResolved() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        vm.prank(referee);
        c.confirmSuccess(id, 0, "");

        Commitment.Stake memory s = c.getStake(id);
        vm.warp(s.deadline + GRACE_WINDOW + 1);
        vm.expectRevert(Commitment.NotActive.selector);
        c.executeFailure(id);
    }

    function test_withdraw_pullsFullBalance() public {
        uint256 id = _create(referee, charity, 0.1 ether);
        vm.prank(referee);
        c.confirmSuccess(id, 0, "");

        uint256 before = staker.balance;
        vm.prank(staker);
        c.withdraw();
        assertEq(staker.balance, before + (0.1 ether - REFEREE_FEE));
        assertEq(c.balances(staker), 0);
    }

    function test_withdraw_revertsWhenNothingOwed() public {
        vm.expectRevert(Commitment.NothingToWithdraw.selector);
        vm.prank(staker);
        c.withdraw();
    }

    function test_adminFunctions_revertForNonTreasury() public {
        vm.startPrank(staker);
        vm.expectRevert(Commitment.NotTreasury.selector);
        c.setPaused(true);
        vm.expectRevert(Commitment.NotTreasury.selector);
        c.setAiPaused(true);
        vm.expectRevert(Commitment.NotTreasury.selector);
        c.setMaxStakeAI(1);
        vm.expectRevert(Commitment.NotTreasury.selector);
        c.setSigner(address(1));
        vm.expectRevert(Commitment.NotTreasury.selector);
        c.skim();
        vm.stopPrank();
    }

    function test_skim_recoversForcedEth() public {
        // Force ETH into the contract via selfdestruct, bypassing createCommitment.
        vm.deal(address(this), 1 ether);
        ForceSend fs = new ForceSend{value: 1 ether}();
        fs.forceSend(payable(address(c)));

        vm.prank(treasury);
        c.skim();
        assertEq(c.balances(treasury), 1 ether);
    }

    function _confirmDigest(uint256 id, bytes32 proofHash, uint256 expiry) internal view returns (bytes32) {
        bytes32 typeHash = keccak256("ConfirmSuccess(uint256 id,bytes32 proofHash,uint256 expiry)");
        bytes32 structHash = keccak256(abi.encode(typeHash, id, proofHash, expiry));
        return keccak256(abi.encodePacked("\x19\x01", c.DOMAIN_SEPARATOR(), structHash));
    }
}

contract ForceSend {
    constructor() payable {}

    function forceSend(address payable target) external {
        selfdestruct(target);
    }
}
