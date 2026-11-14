// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {BcioDesk} from "../src/BcioDesk.sol";
import {TestToken} from "../src/TestToken.sol";

/// Deploy the BCIO desk and its test tokens. Robinhood Chain TESTNET (46630) or local anvil only.
///   KEEPER=<engine keeper address> forge script script/Deploy.s.sol --rpc-url <rpc> --private-key <key> --broadcast
contract Deploy is Script {
    function run() external {
        require(block.chainid == 46630 || block.chainid == 31337, "testnet/local only");
        address keeper = vm.envAddress("KEEPER");
        vm.startBroadcast();
        BcioDesk desk = new BcioDesk(keeper);
        string[7] memory syms = ["USDC", "NVDA", "TSLA", "QQQ", "BTC", "ETH", "SOL"];
        string[7] memory names = ["USD Coin", "Nvidia", "Tesla", "Invesco QQQ", "Bitcoin", "Ethereum", "Solana"];
        console.log("OUT DESK", address(desk));
        for (uint256 i; i < syms.length; i++) {
            TestToken t = new TestToken(
                string.concat("BCIO Test ", names[i]), string.concat("t", syms[i]), i == 0 ? 6 : 18, address(desk)
            );
            if (i == 0) desk.setUsd(t);
            desk.list(t);
            console.log(string.concat("OUT TOKEN ", syms[i]), address(t));
        }
        vm.stopBroadcast();
    }
}
