// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PizzaRat} from "../src/PizzaRat.sol";

contract PizzaRatE2ETest is Test {
    uint256 private constant FEE_WEI = 1 wei;
    uint8 private constant MAX_ROUNDS = 2;

    PizzaRat private rat;
    address[] private players;

    function setUp() public {
        rat = new PizzaRat({
            _minPlayers: 2,
            _maxPlayers: 3,
            _maxRounds: MAX_ROUNDS,
            _lobbyDurationSeconds: 3600,
            _commitDurationSeconds: 3600,
            _revealDurationSeconds: 3600,
            _feeWei: FEE_WEI
        });

        players.push(address(0x1001));
        players.push(address(0x1002));
        players.push(address(0x1003));

        for (uint256 i = 0; i < players.length; i++) {
            vm.deal(players[i], 1 ether);
        }
    }

    function testE2E_freshDeployToGameEndThenReopenLobby() public {
        assertEq(uint8(rat.phase()), uint8(PizzaRat.Phase.Ended));
        assertEq(rat.currentGame(), 0);
        assertEq(rat.currentRound(), 0);

        // First join from Ended should open lobby and add the player.
        vm.prank(players[0]);
        rat.join{value: FEE_WEI}();
        assertEq(uint8(rat.phase()), uint8(PizzaRat.Phase.Lobby));
        assertEq(rat.playerCount(), 1);
        assertTrue(rat.isPlayer(0, players[0]));

        // Fill lobby to max to start commit phase immediately.
        vm.prank(players[1]);
        rat.join{value: FEE_WEI}();
        vm.prank(players[2]);
        rat.join{value: FEE_WEI}();
        assertEq(uint8(rat.phase()), uint8(PizzaRat.Phase.Commit));
        assertEq(rat.currentRound(), 1);

        for (uint8 round = 1; round <= MAX_ROUNDS; round++) {
            _commitRound(round);
            assertEq(uint8(rat.phase()), uint8(PizzaRat.Phase.Reveal));

            _revealRound(round);

            if (round < MAX_ROUNDS) {
                assertEq(uint8(rat.phase()), uint8(PizzaRat.Phase.Commit));
                assertEq(rat.currentRound(), round + 1);
            } else {
                assertEq(uint8(rat.phase()), uint8(PizzaRat.Phase.Ended));
                assertEq(rat.currentRound(), 0);
                assertEq(rat.currentGame(), 1);
            }
        }

        // New game should be able to open lobby again from Ended.
        vm.prank(players[0]);
        rat.join{value: FEE_WEI}();
        assertEq(uint8(rat.phase()), uint8(PizzaRat.Phase.Lobby));
        assertEq(rat.currentGame(), 1);
        assertEq(rat.playerCount(), 1);
        assertTrue(rat.isPlayer(1, players[0]));
    }

    function _commitRound(uint8 round) internal {
        uint256 gameNumber = rat.currentGame();
        for (uint256 i = 0; i < players.length; i++) {
            bytes32 salt = _saltFor(round, i);
            PizzaRat.Ingredient[5] memory ingredients = _ingredientsFor(i);
            bytes32 commitment = rat.computeCommitHash(players[i], gameNumber, round, salt, ingredients);

            vm.prank(players[i]);
            rat.commit(commitment);
        }
    }

    function _revealRound(uint8 round) internal {
        for (uint256 i = 0; i < players.length; i++) {
            bytes32 salt = _saltFor(round, i);
            PizzaRat.Ingredient[5] memory ingredients = _ingredientsFor(i);
            vm.prank(players[i]);
            rat.reveal(salt, ingredients);
        }
    }

    function _saltFor(uint8 round, uint256 index) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("salt", round, index));
    }

    function _ingredientsFor(uint256 i) internal pure returns (PizzaRat.Ingredient[5] memory ingredients) {
        uint8 tail = uint8((i % 3) + 4); // 4,5,6
        ingredients[0] = PizzaRat.Ingredient.DOUGH;
        ingredients[1] = PizzaRat.Ingredient.DOUGH;
        ingredients[2] = PizzaRat.Ingredient.SAUCE;
        ingredients[3] = PizzaRat.Ingredient.CHEESE;
        ingredients[4] = PizzaRat.Ingredient(tail);
    }
}
