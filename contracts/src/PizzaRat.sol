// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {FixedPointMathLib} from "./libraries/FixedPointMathLib.sol";

contract PizzaRat is AccessControl {
    using FixedPointMathLib for uint256;

    uint256 private constant WAD = 1e18;
    int256 private constant NEG_FIVE_WAD = -5e18;
    uint256 private constant ALPHA_WAD = 1e18; // Default from REFERENCE.py
    uint256 private constant BETA_WAD = 3e17; // 0.3 default from REFERENCE.py
    uint8 private constant NUM_INGREDIENTS = 6;

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
    error RecipeEntryMustBeGreaterThanZero(uint256 index);
    error RecipeSumMustEqualOneWad(uint256 providedSum);

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

    uint256[NUM_INGREDIENTS] public currentRecipeWad;

    mapping(uint256 gameNumber => mapping(uint8 round => mapping(address player => Ingredient[5] ingredients)))
        private revealedIngredients;

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
        currentRecipeWad = _defaultRecipeWad();

        emit LobbyOpened(lobbyOpenedAt, lobbyClosesAt);
    }

    function setCurrentRecipeWad(uint256[NUM_INGREDIENTS] calldata recipeWad) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 sum;
        for (uint256 i = 0; i < NUM_INGREDIENTS; i++) {
            if (recipeWad[i] == 0) {
                revert RecipeEntryMustBeGreaterThanZero(i);
            }
            sum += recipeWad[i];
        }
        if (sum != WAD) {
            revert RecipeSumMustEqualOneWad(sum);
        }
        currentRecipeWad = recipeWad;
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
        revealedIngredients[currentGame][currentRound][msg.sender] = ingredients;

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

    function _scoreRound() internal {
        address[] storage gamePlayers = players[currentGame];
        uint256 activeCount;
        for (uint256 i = 0; i < gamePlayers.length; i++) {
            if (playerData[currentGame][gamePlayers[i]].alive) {
                activeCount += 1;
            }
        }
        if (activeCount == 0) {
            return;
        }

        address[] memory activePlayers = new address[](activeCount);
        uint256 k;
        for (uint256 i = 0; i < gamePlayers.length; i++) {
            address player = gamePlayers[i];
            if (playerData[currentGame][player].alive) {
                activePlayers[k] = player;
                unchecked {
                    k++;
                }
            }
        }

        uint256[] memory contributions = new uint256[](activeCount * NUM_INGREDIENTS);
        uint256[NUM_INGREDIENTS] memory pool;
        for (uint256 i = 0; i < activeCount; i++) {
            address player = activePlayers[i];
            if (!reveals[currentGame][currentRound][player]) {
                continue;
            }

            Ingredient[5] memory ingredients = revealedIngredients[currentGame][currentRound][player];
            uint256[NUM_INGREDIENTS] memory vec = _ingredientsToVector(ingredients);
            for (uint256 j = 0; j < NUM_INGREDIENTS; j++) {
                uint256 amount = vec[j];
                contributions[(i * NUM_INGREDIENTS) + j] = amount;
                pool[j] += amount;
            }
        }

        uint256 qualityAll = _computeQualityWad(pool, currentRecipeWad);
        uint256[] memory uniqueness = _computeUniquenessWad(contributions, pool, activeCount);
        uint256[] memory contribution = _computeContributionWad(
            contributions,
            pool,
            currentRecipeWad,
            qualityAll,
            activeCount
        );

        for (uint256 i = 0; i < activeCount; i++) {
            uint256 u = uniqueness[i];
            uint256 c = contribution[i];
            int256 scoreSigned = FixedPointMathLib.sMulWad(
                FixedPointMathLib.powWad(int256(u), int256(ALPHA_WAD)),
                int256(BETA_WAD + c)
            );
            uint256 roundScore = scoreSigned > 0 ? uint256(scoreSigned) : 0;
            playerData[currentGame][activePlayers[i]].score += roundScore;
        }
    }

    function _computeQualityWad(
        uint256[NUM_INGREDIENTS] memory pool,
        uint256[NUM_INGREDIENTS] memory recipeWad
    ) internal pure returns (uint256) {
        uint256 poolTotal;
        for (uint256 j = 0; j < NUM_INGREDIENTS; j++) {
            poolTotal += pool[j];
        }
        if (poolTotal == 0) {
            return 0;
        }

        uint256 distanceSquaredWad;
        for (uint256 j = 0; j < NUM_INGREDIENTS; j++) {
            uint256 proportionWad = (pool[j] * WAD) / poolTotal;
            uint256 diff = _absDiff(proportionWad, recipeWad[j]);
            distanceSquaredWad += diff.mulWad(diff);
        }
        uint256 distanceWad = FixedPointMathLib.sqrtWad(distanceSquaredWad);
        int256 exponent = FixedPointMathLib.sMulWad(NEG_FIVE_WAD, int256(distanceWad));
        int256 quality = FixedPointMathLib.expWad(exponent);
        return quality <= 0 ? 0 : uint256(quality);
    }

    function _computeUniquenessWad(
        uint256[] memory contributions,
        uint256[NUM_INGREDIENTS] memory pool,
        uint256 n
    ) internal pure returns (uint256[] memory uniqueness) {
        uniqueness = new uint256[](n);
        if (n <= 1) {
            if (n == 1) {
                uniqueness[0] = 5e17;
            }
            return uniqueness;
        }

        uint256[NUM_INGREDIENTS] memory avgWad;
        for (uint256 j = 0; j < NUM_INGREDIENTS; j++) {
            avgWad[j] = (pool[j] * WAD) / n;
        }

        uint256[] memory raw = new uint256[](n);
        uint256 maxRaw;
        for (uint256 i = 0; i < n; i++) {
            uint256 d2Wad;
            for (uint256 j = 0; j < NUM_INGREDIENTS; j++) {
                uint256 xWad = contributions[(i * NUM_INGREDIENTS) + j] * WAD;
                uint256 diff = _absDiff(xWad, avgWad[j]);
                d2Wad += diff.mulWad(diff);
            }
            uint256 d = FixedPointMathLib.sqrtWad(d2Wad);
            raw[i] = d;
            if (d > maxRaw) {
                maxRaw = d;
            }
        }

        if (maxRaw == 0) {
            return uniqueness;
        }

        for (uint256 i = 0; i < n; i++) {
            uniqueness[i] = raw[i].divWad(maxRaw);
        }
    }

    function _computeContributionWad(
        uint256[] memory contributions,
        uint256[NUM_INGREDIENTS] memory pool,
        uint256[NUM_INGREDIENTS] memory recipeWad,
        uint256 qualityAll,
        uint256 n
    ) internal pure returns (uint256[] memory normalized) {
        normalized = new uint256[](n);
        if (n == 0) {
            return normalized;
        }

        int256[] memory raw = new int256[](n);
        int256 minRaw = type(int256).max;
        int256 maxRaw = type(int256).min;

        for (uint256 i = 0; i < n; i++) {
            uint256[NUM_INGREDIENTS] memory poolWithout;
            for (uint256 j = 0; j < NUM_INGREDIENTS; j++) {
                poolWithout[j] = pool[j] - contributions[(i * NUM_INGREDIENTS) + j];
            }

            uint256 qualityWithout = _computeQualityWad(poolWithout, recipeWad);
            int256 delta = int256(qualityAll) - int256(qualityWithout);
            raw[i] = delta;
            if (delta < minRaw) {
                minRaw = delta;
            }
            if (delta > maxRaw) {
                maxRaw = delta;
            }
        }

        if (maxRaw == minRaw) {
            for (uint256 i = 0; i < n; i++) {
                normalized[i] = 5e17;
            }
            return normalized;
        }

        uint256 range = uint256(maxRaw - minRaw);
        for (uint256 i = 0; i < n; i++) {
            uint256 shifted = uint256(raw[i] - minRaw);
            normalized[i] = (shifted * WAD) / range;
        }
    }

    function _ingredientsToVector(Ingredient[5] memory ingredients) internal pure returns (uint256[NUM_INGREDIENTS] memory vec) {
        for (uint256 i = 0; i < 5; i++) {
            uint8 ingredientIndex = uint8(ingredients[i]);
            if (ingredientIndex == 0) {
                continue;
            }
            unchecked {
                vec[ingredientIndex - 1] += 1;
            }
        }
    }

    function _defaultRecipeWad() internal pure returns (uint256[NUM_INGREDIENTS] memory recipe) {
        uint256 base = WAD / NUM_INGREDIENTS;
        for (uint256 i = 0; i < NUM_INGREDIENTS; i++) {
            recipe[i] = base;
        }
        recipe[0] += WAD - (base * NUM_INGREDIENTS);
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }

    function _removePlayer(address player) internal {
        playerData[currentGame][player].alive = false;
    }
}
