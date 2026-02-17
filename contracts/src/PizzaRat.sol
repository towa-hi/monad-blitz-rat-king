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
    error IngredientCannotBeNothing(uint256 index);
    error IngredientsMustBeSortedAscending(uint256 index, Ingredient previousIngredient, Ingredient currentIngredient);
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

    enum Ingredient {
        NOTHING,
        DOUGH,
        SAUCE,
        CHEESE,
        PEPPERONI,
        BASIL,
        ANCHOVY
    }

    struct RoundEntry {
        uint256 score; // starts at zero, compounds
        Ingredient[5] ingredients;
    }

    struct PlayerGameData {
        bool alive;
        uint256 score;
        bytes32 latestCommitHash;
        RoundEntry[] rounds;
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
    uint256 public currentGame;
    uint8 public currentRound;
    uint16 public playerCount;
    uint64 public phaseDeadline;

    mapping(uint256 gameNumber => address[] players) private players;
    mapping(uint256 gameNumber => mapping(address player => bool joined)) public isPlayer;
    mapping(uint256 gameNumber => mapping(address player => uint256 oneBasedIndex)) private playerIndex;
    mapping(uint256 gameNumber => mapping(uint8 round => mapping(address player => bytes32 commitment))) private commitments;
    mapping(uint256 gameNumber => mapping(uint8 round => mapping(address player => bool revealed))) private reveals;
    mapping(uint256 gameNumber => mapping(uint8 round => uint16 count)) public commitCounts;
    mapping(uint256 gameNumber => mapping(uint8 round => uint16 count)) public revealCounts;
    mapping(uint256 gameNumber => mapping(address player => PlayerGameData gameData)) private playerData;

    event LobbyOpened(uint64 openedAt, uint64 closesAt);
    event LobbyClosed(uint16 playerCount, uint8 startingRound, uint64 commitDeadline);
    event LobbyCancelled(uint16 playerCount);
    event PlayerJoined(address indexed player, uint256 feeWei, uint16 playerCount);
    event PlayerLeft(address indexed player, uint16 playerCount);
    event CommitSubmitted(address indexed player, uint8 indexed round, bytes32 commitment);
    event RevealSubmitted(address indexed player, uint8 indexed round, bytes32 salt, Ingredient[5] ingredients);
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
        if (isPlayer[currentGame][msg.sender]) {
            revert PlayerAlreadyJoined(msg.sender);
        }
        if (playerCount >= maxPlayers) {
            revert LobbyIsFull(maxPlayers);
        }

        isPlayer[currentGame][msg.sender] = true;
        players[currentGame].push(msg.sender);
        playerIndex[currentGame][msg.sender] = players[currentGame].length;
        playerData[currentGame][msg.sender].alive = true;
        playerCount += 1;

        emit PlayerJoined(msg.sender, msg.value, playerCount);

        if (playerCount == maxPlayers) {
            _closeLobbyAndOpenCommit();
        }
    }

    function leave() external {
        _syncPhaseByTime();
        if (!playerData[currentGame][msg.sender].alive) {
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
        if (!playerData[currentGame][msg.sender].alive) {
            revert PlayerNotJoined(msg.sender);
        }
        if (commitment == bytes32(0)) {
            revert EmptyCommitment();
        }
        if (commitments[currentGame][currentRound][msg.sender] != bytes32(0)) {
            revert CommitmentAlreadySubmitted(msg.sender, currentRound);
        }

        commitments[currentGame][currentRound][msg.sender] = commitment;
        playerData[currentGame][msg.sender].latestCommitHash = commitment;
        commitCounts[currentGame][currentRound] += 1;

        emit CommitSubmitted(msg.sender, currentRound, commitment);

        if (commitCounts[currentGame][currentRound] == playerCount) {
            _openRevealPhase();
        }
    }

    function reveal(bytes32 salt, Ingredient[5] calldata ingredients) external {
        _syncPhaseByTime();
        if (phase == Phase.Cancelled) {
            revert LobbyHasBeenCancelled();
        }
        if (phase != Phase.Reveal) {
            revert RevealPhaseIsClosed();
        }
        if (!playerData[currentGame][msg.sender].alive) {
            revert PlayerNotJoined(msg.sender);
        }

        bytes32 commitment = commitments[currentGame][currentRound][msg.sender];
        if (commitment == bytes32(0)) {
            revert CommitmentMissing(msg.sender, currentRound);
        }
        if (reveals[currentGame][currentRound][msg.sender]) {
            revert RevealAlreadySubmitted(msg.sender, currentRound);
        }

        for (uint256 i = 0; i < 5; i++) {
            if (ingredients[i] == Ingredient.NOTHING) {
                revert IngredientCannotBeNothing(i);
            }
            if (i > 0 && uint8(ingredients[i]) < uint8(ingredients[i - 1])) {
                revert IngredientsMustBeSortedAscending(i, ingredients[i - 1], ingredients[i]);
            }
        }

        bytes32 revealHash = computeCommitHash(msg.sender, currentGame, currentRound, salt, ingredients);
        if (revealHash != commitment) {
            revert RevealDoesNotMatchCommitment(msg.sender, currentRound);
        }

        reveals[currentGame][currentRound][msg.sender] = true;
        revealCounts[currentGame][currentRound] += 1;

        uint256 currentScore = playerData[currentGame][msg.sender].score;
        playerData[currentGame][msg.sender].rounds.push(
            RoundEntry({score: currentScore, ingredients: ingredients})
        );

        emit RevealSubmitted(msg.sender, currentRound, salt, ingredients);

        if (revealCounts[currentGame][currentRound] == commitCounts[currentGame][currentRound]) {
            _advanceRoundOrEndGame();
        }
    }

    function computeCommitHash(
        address player,
        uint256 gameNumber,
        uint8 round,
        bytes32 salt,
        Ingredient[5] memory ingredients
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(player, gameNumber, round, salt, ingredients));
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

    function getPlayers(uint256 gameNumber) external view returns (address[] memory) {
        return players[gameNumber];
    }

    function getCommitment(uint256 gameNumber, uint8 round, address player) external view returns (bytes32) {
        return commitments[gameNumber][round][player];
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

        _scoreRound();

        if (currentRound >= maxRounds) {
            phase = Phase.Ended;
            phaseDeadline = 0;
            emit GameEnded(currentRound);
            currentGame += 1;
            return;
        }

        currentRound += 1;
        phase = Phase.Commit;
        phaseDeadline = uint64(block.timestamp) + roundDurationSeconds;

        emit RoundPhaseAdvanced(currentRound, Phase.Commit, phaseDeadline);
    }

    function _scoreRound() internal view {
        currentGame;
        currentRound;
        // TODO: implement scoring for all revealed players in the provided game/round.
    }

    function _removePlayer(address player) internal {
        playerData[currentGame][player].alive = false;
    }
}
