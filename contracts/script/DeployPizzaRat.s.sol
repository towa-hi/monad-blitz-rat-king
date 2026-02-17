// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PizzaRat} from "../src/PizzaRat.sol";

contract DeployPizzaRat is Script {
    function run() external returns (PizzaRat deployed) {
        uint8 minPlayers = uint8(vm.envOr("PIZZA_RAT_MIN_PLAYERS", uint256(2)));
        uint8 maxPlayers = uint8(vm.envOr("PIZZA_RAT_MAX_PLAYERS", uint256(20)));
        uint8 maxRounds = uint8(vm.envOr("PIZZA_RAT_MAX_ROUNDS", uint256(10)));
        uint16 lobbyDurationSeconds = uint16(vm.envOr("PIZZA_RAT_LOBBY_DURATION_SECONDS", uint256(900)));
        uint16 commitDurationSeconds = uint16(vm.envOr("PIZZA_RAT_COMMIT_DURATION_SECONDS", uint256(120)));
        uint16 revealDurationSeconds = uint16(vm.envOr("PIZZA_RAT_REVEAL_DURATION_SECONDS", uint256(120)));
        uint256 feeWei = vm.envOr("PIZZA_RAT_FEE_WEI", uint256(1e15));

        vm.startBroadcast();
        deployed = new PizzaRat(
            minPlayers,
            maxPlayers,
            maxRounds,
            lobbyDurationSeconds,
            commitDurationSeconds,
            revealDurationSeconds,
            feeWei
        );
        vm.stopBroadcast();

        console.log("PIZZA_RAT_DEPLOYED_ADDRESS", address(deployed));
    }
}
