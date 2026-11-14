// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {BcioDesk} from "../src/BcioDesk.sol";
import {TestToken} from "../src/TestToken.sol";

contract BcioDeskTest is Test {
    BcioDesk desk;
    TestToken usdc;
    TestToken nvda;
    TestToken btc;
    address keeper = address(0xBEEF);
    address agent = address(0xA9E);
    address user = address(0x1234);
    address other = address(0x9999);

    function setUp() public {
        vm.warp(1_800_000_000);
        desk = new BcioDesk(keeper);
        usdc = new TestToken("Test USDC", "tUSDC", 6, address(desk));
        nvda = new TestToken("Test Nvidia", "tNVDA", 18, address(desk));
        btc = new TestToken("Test Bitcoin", "tBTC", 18, address(desk));
        desk.setUsd(usdc);
        desk.list(usdc);
        desk.list(nvda);
        desk.list(btc);
        _prices(1e8, 160e8, 65_000e8);
        vm.prank(user);
        desk.faucet();
    }

    function _prices(uint256 u, uint256 n, uint256 b) internal {
        address[] memory ts = new address[](3);
        uint256[] memory ps = new uint256[](3);
        (ts[0], ts[1], ts[2]) = (address(usdc), address(nvda), address(btc));
        (ps[0], ps[1], ps[2]) = (u, n, b);
        vm.prank(keeper);
        desk.setPrices(ts, ps);
    }

    function test_faucetAndCooldown() public {
        assertEq(usdc.balanceOf(user), 10_000e6);
        vm.prank(user);
        vm.expectRevert();
        desk.faucet();
        vm.warp(block.timestamp + 1 days + 1);
        _prices(1e8, 160e8, 65_000e8);
        vm.prank(user);
        desk.faucet();
        assertEq(usdc.balanceOf(user), 20_000e6);
    }

    function test_swapAtOraclePriceMinusFee() public {
        vm.prank(user);
        uint256 out = desk.swap(address(usdc), address(nvda), 1_600e6, 0);
        // 1600 USD / 160 = 10 NVDA, minus 0.10% fee
        assertEq(out, 10e18 - 10e18 / 1000);
        assertEq(nvda.balanceOf(user), out);
        assertEq(usdc.balanceOf(user), 8_400e6);
    }

    function test_slippageReverts() public {
        vm.prank(user);
        vm.expectRevert();
        desk.swap(address(usdc), address(nvda), 1_600e6, 10e18);
    }

    function test_basketSplitsByWeight() public {
        address[] memory outs = new address[](2);
        uint16[] memory w = new uint16[](2);
        uint256[] memory mins = new uint256[](2);
        (outs[0], outs[1]) = (address(nvda), address(btc));
        (w[0], w[1]) = (5000, 5000);
        vm.prank(user);
        desk.swapBasket(address(usdc), 1_000e6, outs, w, mins);
        assertEq(usdc.balanceOf(user), 9_000e6);
        assertApproxEqRel(desk.valueOf(address(nvda), nvda.balanceOf(user)), 500e8, 0.002e18);
        assertApproxEqRel(desk.valueOf(address(btc), btc.balanceOf(user)), 500e8, 0.002e18);
    }

    function test_badWeightsRevert() public {
        address[] memory outs = new address[](1);
        uint16[] memory w = new uint16[](1);
        uint256[] memory mins = new uint256[](1);
        outs[0] = address(nvda);
        w[0] = 9000;
        vm.prank(user);
        vm.expectRevert(BcioDesk.BadWeights.selector);
        desk.swapBasket(address(usdc), 1_000e6, outs, w, mins);
    }

    function test_stalePriceBlocksTrading() public {
        vm.warp(block.timestamp + 2 hours);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(BcioDesk.StalePrice.selector, address(usdc)));
        desk.swap(address(usdc), address(nvda), 100e6, 0);
    }

    function test_agentWithoutPolicyReverts() public {
        vm.prank(agent);
        vm.expectRevert(BcioDesk.NoPolicy.selector);
        desk.executeFor(user, address(usdc), address(nvda), 100e6, 0);
    }

    function test_agentWithinLimits() public {
        vm.prank(user);
        desk.setAgent(agent, 1_000e8, 1_500e8, uint64(block.timestamp + 7 days));
        vm.prank(agent);
        desk.executeFor(user, address(usdc), address(nvda), 1_000e6, 0);
        assertGt(nvda.balanceOf(user), 0);
        assertEq(nvda.balanceOf(agent), 0); // value stays with the user
        // per-trade limit
        vm.prank(agent);
        vm.expectRevert();
        desk.executeFor(user, address(usdc), address(btc), 1_001e6, 0);
        // daily limit: 1000 already spent, 600 more > 1500
        vm.prank(agent);
        vm.expectRevert();
        desk.executeFor(user, address(usdc), address(btc), 600e6, 0);
        // next day the budget resets
        vm.warp(block.timestamp + 1 days);
        _prices(1e8, 160e8, 65_000e8);
        vm.prank(agent);
        desk.executeFor(user, address(usdc), address(btc), 600e6, 0);
    }

    function test_onlyTheNamedAgent() public {
        vm.prank(user);
        desk.setAgent(agent, 1_000e8, 1_500e8, uint64(block.timestamp + 7 days));
        vm.prank(other);
        vm.expectRevert(BcioDesk.NoPolicy.selector);
        desk.executeFor(user, address(usdc), address(nvda), 100e6, 0);
    }

    function test_expiryAndRevoke() public {
        vm.prank(user);
        desk.setAgent(agent, 1_000e8, 1_500e8, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        _prices(1e8, 160e8, 65_000e8);
        vm.prank(agent);
        vm.expectRevert(BcioDesk.PolicyExpired.selector);
        desk.executeFor(user, address(usdc), address(nvda), 100e6, 0);

        vm.prank(user);
        desk.setAgent(agent, 1_000e8, 1_500e8, uint64(block.timestamp + 1 days));
        vm.prank(user);
        desk.revokeAgent(agent);
        vm.prank(agent);
        vm.expectRevert(BcioDesk.NoPolicy.selector);
        desk.executeFor(user, address(usdc), address(nvda), 100e6, 0);
    }

    function test_onlyKeeperSetsPrices() public {
        address[] memory ts = new address[](1);
        uint256[] memory ps = new uint256[](1);
        ts[0] = address(nvda);
        ps[0] = 1;
        vm.prank(other);
        vm.expectRevert(BcioDesk.NotKeeper.selector);
        desk.setPrices(ts, ps);
    }

    function test_onlyDeskMints() public {
        vm.prank(user);
        vm.expectRevert(TestToken.OnlyDesk.selector);
        nvda.mint(user, 1);
    }
}
