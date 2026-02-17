// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PizzaRat} from "../src/PizzaRat.sol";

contract PizzaRatGasTest is Test {
    uint256 private constant NUM_PLAYERS = 20;
    uint256 private constant FEE_WEI = 1 wei;

    PizzaRat private rat;
    address[] private players;
    bytes32[] private salts;

    function setUp() public {
        rat = new PizzaRat({
            _minPlayers: 2,
            _maxPlayers: uint8(NUM_PLAYERS),
            _maxRounds: 1,
            _lobbyDurationSeconds: 3600,
            _roundDurationSeconds: 3600,
            _feeWei: FEE_WEI
        });

        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            address player = address(uint160(0x1000 + i));
            players.push(player);
            salts.push(keccak256(abi.encodePacked("salt", i)));
            vm.deal(player, 10 ether);
        }
    }

    function testGas_lastRevealTriggersRoundScoring_20Players() public {
        _joinAllPlayers();
        _commitAllPlayers();
        _revealAllButLastPlayer();

        uint256 gasBefore = gasleft();
        _revealAsPlayer(NUM_PLAYERS - 1);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("gas_last_reveal_with_scoring_20_players", gasUsed);
    }

    function _joinAllPlayers() internal {
        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            vm.prank(players[i]);
            rat.join{value: FEE_WEI}();
        }
    }

    function _commitAllPlayers() internal {
        for (uint256 i = 0; i < NUM_PLAYERS; i++) {
            PizzaRat.Ingredient[5] memory ingredients = _ingredientsForPlayer(i);
            bytes32 commitment = rat.computeCommitHash(players[i], rat.currentGame(), rat.currentRound(), salts[i], ingredients);

            vm.prank(players[i]);
            rat.commit(commitment);
        }
    }

    function _revealAllButLastPlayer() internal {
        for (uint256 i = 0; i < NUM_PLAYERS - 1; i++) {
            _revealAsPlayer(i);
        }
    }

    function _revealAsPlayer(uint256 i) internal {
        PizzaRat.Ingredient[5] memory ingredients = _ingredientsForPlayer(i);
        vm.prank(players[i]);
        rat.reveal(salts[i], ingredients);
    }

    function _ingredientsForPlayer(uint256 i) internal pure returns (PizzaRat.Ingredient[5] memory ingredients) {
        uint8 tail = uint8((i % 3) + 4); // 4,5,6
        ingredients[0] = PizzaRat.Ingredient.DOUGH;
        ingredients[1] = PizzaRat.Ingredient.DOUGH;
        ingredients[2] = PizzaRat.Ingredient.SAUCE;
        ingredients[3] = PizzaRat.Ingredient.CHEESE;
        ingredients[4] = PizzaRat.Ingredient(tail);
    }
}
