// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract PizzaRat is AccessControl {
    error MinPlayersMustBeGreaterThanZero();
    error MaxPlayersMustBeGreaterThanMinPlayers();
    error LobbyDurationMustBeGreaterThanZero();
    error RoundDurationMustBeGreaterThanZero();
    error MaxRoundsMustBeGreaterThanZero();
    error JoinFeeMustBeGreaterThanZero();
    error LobbyIsClosed();
    error LobbyHasBeenCancelled();
    error JoinFeeMismatch(uint256 expectedFeeWei, uint256 receivedFeeWei);
    error PlayerAlreadyJoined(address player);
    error LobbyIsFull(uint8 maxPlayers);
    error PlayerNotJoined(address player);
    error RefundFailed();
    error CommitPhaseIsClosed();
    error RevealPhaseIsClosed();
    error EmptyCommitment();
    error CommitmentAlreadySubmitted(address player, uint8 round);
    error CommitmentMissing(address player, uint8 round);
    error RevealAlreadySubmitted(address player, uint8 round);
    error RevealDoesNotMatchCommitment(address player, uint8 round);
    error RoundStateMismatch(Phase expectedPhaseA, Phase expectedPhaseB, Phase actualPhase);
    error RoundNumberMismatch(uint8 expectedRound, uint8 providedRound);
    error RoundCloseTooSoon(uint64 phaseDeadline, uint64 currentTimestamp);

    enum Phase {
        Lobby,
        Commit,
        Reveal,
        Ended,
        Cancelled
    }

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    uint8 public immutable minPlayers;
    uint8 public immutable maxPlayers;
    uint8 public immutable maxRounds;
    uint16 public immutable lobbyDurationSeconds;
    uint16 public immutable roundDurationSeconds;
    uint256 public immutable feeWei;
    uint64 public immutable lobbyOpenedAt;
    uint64 public immutable lobbyClosesAt;

    Phase public phase;
    uint8 public currentRound;
    uint16 public playerCount;
    uint64 public phaseDeadline;

    address[] private players;
    mapping(address player => bool joined) public isPlayer;
    mapping(address player => uint256 oneBasedIndex) private playerIndex;
    mapping(uint8 round => mapping(address player => bytes32 commitment)) private commitments;
    mapping(uint8 round => mapping(address player => bool revealed)) private reveals;
    mapping(uint8 round => uint16 count) public commitCounts;
    mapping(uint8 round => uint16 count) public revealCounts;

    event LobbyOpened(uint64 openedAt, uint64 closesAt);
    event LobbyClosed(uint16 playerCount, uint8 startingRound, uint64 commitDeadline);
    event LobbyCancelled(uint16 playerCount);
    event PlayerJoined(address indexed player, uint256 feeWei, uint16 playerCount);
    event PlayerLeft(address indexed player, uint16 playerCount);
    event CommitSubmitted(address indexed player, uint8 indexed round, bytes32 commitment);
    event RevealSubmitted(address indexed player, uint8 indexed round, uint8 move, bytes32 salt);
    event RoundPhaseAdvanced(uint8 indexed round, Phase phase, uint64 phaseDeadline);
    event GameEnded(uint8 indexed finalRound);

    constructor(
        uint8 _minPlayers,
        uint8 _maxPlayers,
        uint8 _maxRounds,
        uint16 _lobbyDurationSeconds,
        uint16 _roundDurationSeconds,
        uint256 _feeWei
    ) {
        if (_minPlayers == 0) {
            revert MinPlayersMustBeGreaterThanZero();
        }
        if (_maxPlayers <= _minPlayers) {
            revert MaxPlayersMustBeGreaterThanMinPlayers();
        }
        if (_lobbyDurationSeconds == 0) {
            revert LobbyDurationMustBeGreaterThanZero();
        }
        if (_roundDurationSeconds == 0) {
            revert RoundDurationMustBeGreaterThanZero();
        }
        if (_maxRounds == 0) {
            revert MaxRoundsMustBeGreaterThanZero();
        }
        if (_feeWei == 0) {
            revert JoinFeeMustBeGreaterThanZero();
        }

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);

        minPlayers = _minPlayers;
        maxPlayers = _maxPlayers;
        maxRounds = _maxRounds;
        lobbyDurationSeconds = _lobbyDurationSeconds;
        roundDurationSeconds = _roundDurationSeconds;
        feeWei = _feeWei;
        lobbyOpenedAt = uint64(block.timestamp);
        lobbyClosesAt = uint64(block.timestamp) + _lobbyDurationSeconds;
        phase = Phase.Lobby;

        emit LobbyOpened(lobbyOpenedAt, lobbyClosesAt);
    }

    function join() external payable {
        _syncPhaseByTime();
        if (phase == Phase.Cancelled) {
            revert LobbyHasBeenCancelled();
        }
        if (phase != Phase.Lobby) {
            revert LobbyIsClosed();
        }
        if (msg.value != feeWei) {
            revert JoinFeeMismatch(feeWei, msg.value);
        }
        if (isPlayer[msg.sender]) {
            revert PlayerAlreadyJoined(msg.sender);
        }
        if (playerCount >= maxPlayers) {
            revert LobbyIsFull(maxPlayers);
        }

        isPlayer[msg.sender] = true;
        players.push(msg.sender);
        playerIndex[msg.sender] = players.length;
        playerCount += 1;

        emit PlayerJoined(msg.sender, msg.value, playerCount);

        if (playerCount == maxPlayers) {
            _closeLobbyAndOpenCommit();
        }
    }

    function leave() external {
        _syncPhaseByTime();
        if (!isPlayer[msg.sender]) {
            revert PlayerNotJoined(msg.sender);
        }
        if (phase != Phase.Lobby && phase != Phase.Cancelled) {
            revert LobbyIsClosed();
        }

        _removePlayer(msg.sender);
        playerCount -= 1;
        emit PlayerLeft(msg.sender, playerCount);

        (bool ok,) = payable(msg.sender).call{value: feeWei}("");
        if (!ok) {
            revert RefundFailed();
        }
    }

    function commit(bytes32 commitment) external {
        _syncPhaseByTime();
        if (phase == Phase.Cancelled) {
            revert LobbyHasBeenCancelled();
        }
        if (phase != Phase.Commit) {
            revert CommitPhaseIsClosed();
        }
        if (!isPlayer[msg.sender]) {
            revert PlayerNotJoined(msg.sender);
        }
        if (commitment == bytes32(0)) {
            revert EmptyCommitment();
        }
        if (commitments[currentRound][msg.sender] != bytes32(0)) {
            revert CommitmentAlreadySubmitted(msg.sender, currentRound);
        }

        commitments[currentRound][msg.sender] = commitment;
        commitCounts[currentRound] += 1;

        emit CommitSubmitted(msg.sender, currentRound, commitment);

        if (commitCounts[currentRound] == playerCount) {
            _openRevealPhase();
        }
    }

    function reveal(uint8 move, bytes32 salt) external {
        _syncPhaseByTime();
        if (phase == Phase.Cancelled) {
            revert LobbyHasBeenCancelled();
        }
        if (phase != Phase.Reveal) {
            revert RevealPhaseIsClosed();
        }
        if (!isPlayer[msg.sender]) {
            revert PlayerNotJoined(msg.sender);
        }

        bytes32 commitment = commitments[currentRound][msg.sender];
        if (commitment == bytes32(0)) {
            revert CommitmentMissing(msg.sender, currentRound);
        }
        if (reveals[currentRound][msg.sender]) {
            revert RevealAlreadySubmitted(msg.sender, currentRound);
        }

        bytes32 revealHash = keccak256(abi.encodePacked(msg.sender, currentRound, move, salt));
        if (revealHash != commitment) {
            revert RevealDoesNotMatchCommitment(msg.sender, currentRound);
        }

        reveals[currentRound][msg.sender] = true;
        revealCounts[currentRound] += 1;

        emit RevealSubmitted(msg.sender, currentRound, move, salt);

        if (revealCounts[currentRound] == commitCounts[currentRound]) {
            _advanceRoundOrEndGame();
        }
    }

    function closeRound(uint8 round) external onlyRole(RELAYER_ROLE) {
        _syncPhaseByTime();
        if (phase != Phase.Commit && phase != Phase.Reveal) {
            revert RoundStateMismatch(Phase.Commit, Phase.Reveal, phase);
        }
        if (round != currentRound) {
            revert RoundNumberMismatch(currentRound, round);
        }
        if (block.timestamp < phaseDeadline) {
            revert RoundCloseTooSoon(phaseDeadline, uint64(block.timestamp));
        }

        if (phase == Phase.Commit) {
            _openRevealPhase();
            return;
        }

        _advanceRoundOrEndGame();
    }

    function getPlayers() external view returns (address[] memory) {
        return players;
    }

    function getCommitment(uint8 round, address player) external view returns (bytes32) {
        return commitments[round][player];
    }

    function _syncPhaseByTime() internal {
        if (phase == Phase.Lobby && block.timestamp >= lobbyClosesAt) {
            if (playerCount < minPlayers) {
                phase = Phase.Cancelled;
                emit LobbyCancelled(playerCount);
                return;
            }

            _closeLobbyAndOpenCommit();
            return;
        }

        if (phase == Phase.Commit && block.timestamp >= phaseDeadline) {
            _openRevealPhase();
            return;
        }

        if (phase == Phase.Reveal && block.timestamp >= phaseDeadline) {
            _advanceRoundOrEndGame();
        }
    }

    function _closeLobbyAndOpenCommit() internal {
        if (phase != Phase.Lobby) {
            return;
        }

        phase = Phase.Commit;
        currentRound = 1;
        phaseDeadline = uint64(block.timestamp) + roundDurationSeconds;

        emit LobbyClosed(playerCount, currentRound, phaseDeadline);
        emit RoundPhaseAdvanced(currentRound, Phase.Commit, phaseDeadline);
    }

    function _openRevealPhase() internal {
        if (phase != Phase.Commit) {
            return;
        }

        phase = Phase.Reveal;
        phaseDeadline = uint64(block.timestamp) + roundDurationSeconds;

        emit RoundPhaseAdvanced(currentRound, Phase.Reveal, phaseDeadline);
    }

    function _advanceRoundOrEndGame() internal {
        if (phase != Phase.Reveal) {
            return;
        }

        if (currentRound >= maxRounds) {
            phase = Phase.Ended;
            phaseDeadline = 0;
            emit GameEnded(currentRound);
            return;
        }

        currentRound += 1;
        phase = Phase.Commit;
        phaseDeadline = uint64(block.timestamp) + roundDurationSeconds;

        emit RoundPhaseAdvanced(currentRound, Phase.Commit, phaseDeadline);
    }

    function _removePlayer(address player) internal {
        uint256 oneBasedIndex = playerIndex[player];
        uint256 removeIndex = oneBasedIndex - 1;
        uint256 lastIndex = players.length - 1;

        if (removeIndex != lastIndex) {
            address movedPlayer = players[lastIndex];
            players[removeIndex] = movedPlayer;
            playerIndex[movedPlayer] = oneBasedIndex;
        }

        players.pop();
        delete playerIndex[player];
        delete isPlayer[player];
    }
}
