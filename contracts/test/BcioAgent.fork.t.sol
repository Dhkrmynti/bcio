// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {BcioAgent, ISwapRouter02} from "../src/BcioAgent.sol";

interface IERC20T {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
}

/// Runs against a fork of Robinhood Chain MAINNET: real Uniswap pools, real Chainlink feeds, real tokens.
///   forge test --match-contract BcioAgentFork --fork-url https://rpc.mainnet.chain.robinhood.com
/// No transaction is sent to the real chain.
contract BcioAgentFork is Test {
    // Robinhood Chain mainnet (4663). Sources: docs.robinhood.com/chain, api.robinhood.com/rhj/assets,
    // Uniswap/contracts deployments/json/4663.json, Chainlink feeds (verified on-chain by description()).
    address constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2; // SwapRouter02
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant WETH_FEED = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant TSLA_FEED = 0x4A1166a659A55625345e9515b32adECea5547C38;
    address constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address constant QQQ_FEED = 0x80901d846d5D7B030F26B480776EE3b29374C2ae;

    BcioAgent desk;
    address user = makeAddr("user");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");

    function setUp() public {
        require(block.chainid == 4663, "run with --fork-url https://rpc.mainnet.chain.robinhood.com");
        desk = new BcioAgent(ISwapRouter02(ROUTER), USDG, USDG_FEED, 2 days);
        desk.list(WETH, WETH_FEED, 2 hours, 100);
        desk.list(NVDA, NVDA_FEED, 4 days, 500);
        desk.list(TSLA, TSLA_FEED, 4 days, 3000);
        desk.list(QQQ, QQQ_FEED, 4 days, 500);

        // give the user real USDG: wrap ETH, swap WETH -> USDG on the real pool
        vm.deal(user, 10 ether);
        vm.startPrank(user);
        IWETH(WETH).deposit{value: 5 ether}();
        IERC20T(WETH).approve(ROUTER, type(uint256).max);
        ISwapRouter02(ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(WETH, USDG, 100, user, 5 ether, 0, 0)
        );
        IERC20T(USDG).approve(address(desk), type(uint256).max);
        IERC20T(NVDA).approve(address(desk), type(uint256).max);
        IERC20T(TSLA).approve(address(desk), type(uint256).max);
        IERC20T(QQQ).approve(address(desk), type(uint256).max);
        vm.stopPrank();
        assertGt(IERC20T(USDG).balanceOf(user), 5_000e6, "user should hold USDG");
    }

    function _allow(address[] memory toks, uint64 perTrade, uint64 perDay, uint16 devBps) internal {
        vm.prank(user);
        desk.setAgent(agent, perTrade, perDay, uint64(block.timestamp + 7 days), devBps, toks);
    }

    function _two() internal pure returns (address[] memory t) {
        t = new address[](2);
        t[0] = NVDA;
        t[1] = TSLA;
    }

    function test_buyAndSellWithinPolicy() public {
        _allow(_two(), 2_000e6, 5_000e6, 300);
        uint256 usd0 = IERC20T(USDG).balanceOf(user);

        vm.prank(agent);
        uint256 got = desk.executeFor(user, USDG, NVDA, 1_000e6, 0);
        assertGt(got, 0);
        assertEq(IERC20T(NVDA).balanceOf(user), got, "NVDA goes to the user");
        assertEq(IERC20T(USDG).balanceOf(user), usd0 - 1_000e6);
        // nothing stays in the contract
        assertEq(IERC20T(NVDA).balanceOf(address(desk)), 0);
        assertEq(IERC20T(USDG).balanceOf(address(desk)), 0);
        // price sanity vs Chainlink: within 3%
        uint256 fair = desk.fairOut(USDG, NVDA, 1_000e6);
        assertGe(got, (fair * 97) / 100);

        vm.prank(agent);
        uint256 back = desk.executeFor(user, NVDA, USDG, got, 0);
        assertGt(back, 960e6, "round trip loses only fees and spread");
        assertEq(IERC20T(NVDA).balanceOf(user), 0);
        assertEq(IERC20T(USDG).balanceOf(address(desk)), 0);
    }

    function test_limitsAreEnforced() public {
        _allow(_two(), 1_000e6, 1_500e6, 300);
        vm.startPrank(agent);
        vm.expectRevert();
        desk.executeFor(user, USDG, NVDA, 1_200e6, 0); // over per-trade
        desk.executeFor(user, USDG, NVDA, 900e6, 0);
        vm.expectRevert();
        desk.executeFor(user, USDG, TSLA, 900e6, 0); // over per-day (1,800 > 1,500)
        vm.stopPrank();
        // next day the budget resets
        vm.warp(block.timestamp + 1 days);
        // feeds are not updated on a fork; give them room by re-listing with a wide window for this check
        desk.list(TSLA, TSLA_FEED, 30 days, 3000);
        desk.list(NVDA, NVDA_FEED, 30 days, 500);
        vm.mockCall(USDG_FEED, abi.encodeWithSignature("latestRoundData()"), abi.encode(uint80(1), int256(1e8), 0, block.timestamp, uint80(1)));
        vm.prank(agent);
        desk.executeFor(user, USDG, TSLA, 900e6, 0);
    }

    function test_onlyAllowedTokensAndUsdPairs() public {
        _allow(_two(), 2_000e6, 5_000e6, 300);
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(BcioAgent.TokenNotAllowed.selector, QQQ));
        desk.executeFor(user, USDG, QQQ, 100e6, 0);
        vm.expectRevert(BcioAgent.NotUsdPair.selector);
        desk.executeFor(user, NVDA, TSLA, 1, 0);
        vm.stopPrank();
    }

    function test_strangerAndOwnerCannotTrade() public {
        _allow(_two(), 2_000e6, 5_000e6, 300);
        vm.prank(stranger);
        vm.expectRevert(BcioAgent.NoPolicy.selector);
        desk.executeFor(user, USDG, NVDA, 100e6, 0);
        // the deployer/owner has no trading path either
        vm.expectRevert(BcioAgent.NoPolicy.selector);
        desk.executeFor(user, USDG, NVDA, 100e6, 0);
    }

    function test_revokeAndExpiry() public {
        _allow(_two(), 2_000e6, 5_000e6, 300);
        vm.prank(user);
        desk.revokeAgent(agent);
        vm.prank(agent);
        vm.expectRevert(BcioAgent.NoPolicy.selector);
        desk.executeFor(user, USDG, NVDA, 100e6, 0);

        _allow(_two(), 2_000e6, 5_000e6, 300);
        vm.warp(block.timestamp + 8 days);
        vm.prank(agent);
        vm.expectRevert(BcioAgent.PolicyExpired.selector);
        desk.executeFor(user, USDG, NVDA, 100e6, 0);
    }

    function test_priceGuard() public {
        // 0.01% allowed deviation: pool fee + spread alone exceed it, so the swap must revert
        _allow(_two(), 2_000e6, 5_000e6, 1);
        vm.prank(agent);
        vm.expectRevert();
        desk.executeFor(user, USDG, NVDA, 1_000e6, 0);

        // a feed that says NVDA is worth 2x its pool price: the oracle floor is unreachable
        _allow(_two(), 2_000e6, 5_000e6, 300);
        (, int256 px,,,) = IAgg(NVDA_FEED).latestRoundData();
        vm.mockCall(NVDA_FEED, abi.encodeWithSignature("latestRoundData()"), abi.encode(uint80(1), px * 2, 0, block.timestamp, uint80(1)));
        vm.prank(agent);
        vm.expectRevert();
        desk.executeFor(user, NVDA, USDG, 1e18, 0);
    }

    function test_stalePriceBlocksTrading() public {
        _allow(_two(), 2_000e6, 5_000e6, 300);
        vm.warp(block.timestamp + 5 days);
        vm.prank(user);
        desk.setAgent(agent, 2_000e6, 5_000e6, uint64(block.timestamp + 7 days), 300, _two());
        vm.prank(agent);
        vm.expectRevert();
        desk.executeFor(user, USDG, NVDA, 100e6, 0);
    }

    function test_badPoliciesRejected() public {
        address[] memory t = _two();
        vm.startPrank(user);
        vm.expectRevert(BcioAgent.BadPolicy.selector);
        desk.setAgent(agent, 0, 1, uint64(block.timestamp + 1 days), 300, t);
        vm.expectRevert(BcioAgent.BadPolicy.selector);
        desk.setAgent(agent, 100, 50, uint64(block.timestamp + 1 days), 300, t);
        vm.expectRevert(BcioAgent.BadPolicy.selector);
        desk.setAgent(agent, 100, 100, uint64(block.timestamp + 1 days), 2_001, t);
        vm.expectRevert(BcioAgent.BadPolicy.selector);
        desk.setAgent(agent, 100, 100, uint64(block.timestamp), 300, t);
        vm.stopPrank();
    }

    function test_onlyOwnerLists() public {
        vm.prank(stranger);
        vm.expectRevert(BcioAgent.NotOwner.selector);
        desk.list(QQQ, QQQ_FEED, 1 days, 500);
    }
}

interface IAgg {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
