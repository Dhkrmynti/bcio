// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {BcioAgent, ISwapRouter02} from "../src/BcioAgent.sol";

/// Deploy BcioAgent on Robinhood Chain MAINNET (4663) and list the tradable tokens.
/// Run through ../deploy.sh mainnet (it checks the chain and writes engine/deployments/4663.json).
/// Addresses: Robinhood docs + api.robinhood.com/rhj/assets (tokens), Uniswap deployments/json/4663.json
/// (SwapRouter02), Chainlink feeds verified on-chain by description().
contract DeployMainnet is Script {
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;

    function run() external {
        require(block.chainid == 4663, "Robinhood Chain mainnet only");
        vm.startBroadcast();
        BcioAgent a = new BcioAgent(ISwapRouter02(ROUTER), USDG, USDG_FEED, 2 days);
        // token, Chainlink USD feed, max feed age, Uniswap v3 fee tier of the deepest token/USDG pool
        a.list(0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73, 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9, 2 hours, 100); // WETH
        a.list(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 4 days, 500); // NVDA
        a.list(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38, 4 days, 3000); // TSLA
        a.list(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 4 days, 500); // QQQ
        vm.stopBroadcast();
        console.log("OUT AGENT_CONTRACT", address(a));
    }
}
