// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Commitment
/// @notice A generic 1:1 commitment stake. Stake real value on a personal
///         commitment; get it back on a confirmed success, or the stake
///         moves to a chosen penalty recipient after a deadline passes
///         unconfirmed. Failure cannot be dodged by staying silent: after
///         the grace window, anyone can permissionlessly trigger it.
contract Commitment {
    enum State {
        Active,
        Resolved
    }

    struct Stake {
        address staker;
        address referee; // address(0) means AI referee mode
        address penaltyRecipient;
        uint256 stakeAmount; // escrowed amount, excludes the protocol fee
        uint256 deadline;
        bool aiMode;
        State state;
        bytes32 proofHash;
    }

    // ---- Immutable configuration, set at deploy ----
    uint256 public immutable MIN_DURATION;
    uint256 public immutable MAX_DURATION;
    uint256 public immutable GRACE_WINDOW;
    uint256 public immutable MIN_STAKE;
    uint256 public immutable PROTOCOL_FEE;
    uint256 public immutable KEEPER_BOUNTY;
    uint256 public immutable REFEREE_FEE;
    address public immutable treasury;
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 private constant CONFIRM_TYPEHASH =
        keccak256("ConfirmSuccess(uint256 id,bytes32 proofHash,uint256 expiry)");

    // Half the secp256k1 curve order, used to reject malleable signatures.
    uint256 private constant _SECP256K1_HALF_N =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    // ---- Mutable admin state ----
    uint256 public maxStakeAI;
    address public attesterSigner;
    bool public paused;
    bool public aiPaused;

    // ---- Core state ----
    uint256 public nextId;
    mapping(uint256 => Stake) public stakes;
    mapping(address => uint256) public balances;
    uint256 public totalEscrowed;
    uint256 public totalOwed;

    event CommitmentCreated(
        uint256 indexed id,
        address indexed staker,
        address referee,
        address penaltyRecipient,
        uint256 stakeAmount,
        uint256 deadline,
        bool aiMode,
        string description
    );
    event ProofSubmitted(uint256 indexed id, string uri, bytes32 proofHash);
    event Resolved(uint256 indexed id, bool success, address indexed resolver);
    event Failed(uint256 indexed id, address indexed staker, bytes32 proofHash);
    event Withdrawn(address indexed account, uint256 amount);

    error Paused();
    error AiPaused();
    error InvalidReferee();
    error InvalidPenaltyRecipient();
    error InvalidDuration();
    error InsufficientStake();
    error StakeTooHighForAi();
    error NotStaker();
    error NotActive();
    error DeadlinePassed();
    error GraceWindowPassed();
    error GraceWindowNotPassed();
    error SignatureExpired();
    error InvalidSignature();
    error NotReferee();
    error NothingToWithdraw();
    error TransferFailed();
    error NotTreasury();
    error NothingToSkim();

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    constructor(
        uint256 _minDuration,
        uint256 _maxDuration,
        uint256 _graceWindow,
        uint256 _minStake,
        uint256 _maxStakeAI,
        uint256 _protocolFee,
        uint256 _keeperBounty,
        uint256 _refereeFee,
        address _treasury,
        address _attesterSigner
    ) {
        require(_minStake >= _keeperBounty + _refereeFee, "min stake too low");
        require(_treasury != address(0), "bad treasury");

        MIN_DURATION = _minDuration;
        MAX_DURATION = _maxDuration;
        GRACE_WINDOW = _graceWindow;
        MIN_STAKE = _minStake;
        PROTOCOL_FEE = _protocolFee;
        KEEPER_BOUNTY = _keeperBounty;
        REFEREE_FEE = _refereeFee;
        treasury = _treasury;
        maxStakeAI = _maxStakeAI;
        attesterSigner = _attesterSigner;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CommitmentStake")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Creates a commitment and escrows the stake. The staker gets
    ///         it back on a confirmed success; otherwise it goes to
    ///         penaltyRecipient once the deadline plus grace window passes.
    function createCommitment(
        string calldata description,
        uint256 deadline,
        address referee,
        address penaltyRecipient
    ) external payable returns (uint256 id) {
        if (paused) revert Paused();
        if (referee == msg.sender) revert InvalidReferee();
        if (penaltyRecipient == msg.sender) revert InvalidPenaltyRecipient();
        if (penaltyRecipient == address(0)) revert InvalidPenaltyRecipient();
        if (deadline <= block.timestamp) revert InvalidDuration();

        uint256 duration = deadline - block.timestamp;
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();

        bool aiMode = referee == address(0);
        if (aiMode && aiPaused) revert AiPaused();

        if (msg.value < MIN_STAKE + PROTOCOL_FEE) revert InsufficientStake();
        uint256 stakeAmount = msg.value - PROTOCOL_FEE;
        if (aiMode && stakeAmount > maxStakeAI) revert StakeTooHighForAi();

        id = nextId++;
        stakes[id] = Stake({
            staker: msg.sender,
            referee: referee,
            penaltyRecipient: penaltyRecipient,
            stakeAmount: stakeAmount,
            deadline: deadline,
            aiMode: aiMode,
            state: State.Active,
            proofHash: bytes32(0)
        });

        totalEscrowed += stakeAmount;
        _credit(treasury, PROTOCOL_FEE);

        emit CommitmentCreated(id, msg.sender, referee, penaltyRecipient, stakeAmount, deadline, aiMode, description);
    }

    /// @notice Staker records proof of completion before the deadline. Only
    ///         the hash is stored; the human readable URI lives in the event.
    function submitProof(uint256 id, string calldata uri) external {
        Stake storage s = stakes[id];
        if (msg.sender != s.staker) revert NotStaker();
        if (s.state != State.Active) revert NotActive();
        if (block.timestamp > s.deadline) revert DeadlinePassed();

        s.proofHash = keccak256(bytes(uri));
        emit ProofSubmitted(id, uri, s.proofHash);
    }

    /// @notice Confirms success. Human mode: only the named referee can
    ///         call it. AI mode: anyone can submit a valid EIP712 signature
    ///         from the attester over the id, proof hash, and expiry.
    function confirmSuccess(uint256 id, uint256 expiry, bytes calldata sig) external {
        Stake storage s = stakes[id];
        if (s.state != State.Active) revert NotActive();
        if (block.timestamp > s.deadline + GRACE_WINDOW) revert GraceWindowPassed();

        if (s.aiMode) {
            if (block.timestamp > expiry) revert SignatureExpired();
            bytes32 structHash = keccak256(abi.encode(CONFIRM_TYPEHASH, id, s.proofHash, expiry));
            bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
            if (_recover(digest, sig) != attesterSigner) revert InvalidSignature();
        } else {
            if (msg.sender != s.referee) revert NotReferee();
        }

        s.state = State.Resolved;
        totalEscrowed -= s.stakeAmount;

        if (s.aiMode) {
            _credit(s.staker, s.stakeAmount);
        } else {
            _credit(s.referee, REFEREE_FEE);
            _credit(s.staker, s.stakeAmount - REFEREE_FEE);
        }

        emit Resolved(id, true, msg.sender);
    }

    /// @notice Permissionlessly triggers failure once the deadline plus
    ///         grace window has passed with no confirmed success. Anyone
    ///         can call this, so silence never dodges the outcome.
    function executeFailure(uint256 id) external {
        Stake storage s = stakes[id];
        if (s.state != State.Active) revert NotActive();
        if (block.timestamp <= s.deadline + GRACE_WINDOW) revert GraceWindowNotPassed();

        s.state = State.Resolved;
        totalEscrowed -= s.stakeAmount;

        uint256 remaining = s.stakeAmount;
        _credit(msg.sender, KEEPER_BOUNTY);
        remaining -= KEEPER_BOUNTY;

        if (!s.aiMode) {
            _credit(s.referee, REFEREE_FEE);
            remaining -= REFEREE_FEE;
        }

        _credit(s.penaltyRecipient, remaining);

        emit Failed(id, s.staker, s.proofHash);
        emit Resolved(id, false, msg.sender);
    }

    /// @notice Pulls any owed balance. The only way ETH leaves this contract.
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        balances[msg.sender] = 0;
        totalOwed -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    function setPaused(bool _paused) external onlyTreasury {
        paused = _paused;
    }

    function setAiPaused(bool _aiPaused) external onlyTreasury {
        aiPaused = _aiPaused;
    }

    function setMaxStakeAI(uint256 _max) external onlyTreasury {
        maxStakeAI = _max;
    }

    function setSigner(address _signer) external onlyTreasury {
        attesterSigner = _signer;
    }

    /// @notice Recovers ETH forced into the contract outside of normal
    ///         staking flow (there is no receive/fallback, so this only
    ///         matters for a selfdestruct-forced transfer). Never touches
    ///         escrowed or owed balances.
    function skim() external onlyTreasury {
        uint256 bal = address(this).balance;
        uint256 stray = bal - totalEscrowed - totalOwed;
        if (stray == 0) revert NothingToSkim();
        _credit(treasury, stray);
    }

    function getStake(uint256 id) external view returns (Stake memory) {
        return stakes[id];
    }

    function _credit(address to, uint256 amount) private {
        balances[to] += amount;
        totalOwed += amount;
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (uint256(s) > _SECP256K1_HALF_N) revert InvalidSignature();

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
