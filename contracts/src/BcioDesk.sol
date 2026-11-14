// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestToken} from "./TestToken.sol";

/// @title BCIO desk (testnet)
/// @notice Swaps BCIO test tokens at oracle prices and lets a user delegate limited
///         trading rights to an AI agent.
///
///  - Prices: USD with 8 decimals, pushed by the keeper from live market data. A swap
///    reverts when a price is older than MAX_AGE, so a stopped keeper cannot trade on
///    old prices.
///  - Agent policy (session key): a user calls setAgent(agent, maxTradeUsd, maxDayUsd,
///    expiry). The agent can then call executeFor(user, ...) only within those limits,
///    only until expiry, and only between listed tokens: it can move value between
///    the user's own positions, never send it anywhere else. revokeAgent ends it at once.
///
///  Testnet only: the desk mints and burns test tokens instead of holding liquidity.
contract BcioDesk {
    uint256 public constant MAX_AGE = 1 hours;
    uint256 public constant FAUCET_AMOUNT = 10_000e6; // 10,000 tUSDC
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    uint16 public constant FEE_BPS = 10; // 0.10%

    struct Policy {
        uint128 maxTradeUsd; // 8 decimals
        uint128 maxDayUsd; // 8 decimals
        uint64 expiry;
        uint64 day;
        uint128 spentToday; // 8 decimals
    }

    address public owner;
    address public keeper;
    TestToken public usd;

    mapping(address => bool) public listed;
    address[] public tokens;
    mapping(address => uint256) public priceE8;
    mapping(address => uint256) public priceAt;
    mapping(address => mapping(address => Policy)) public policies; // user => agent => policy
    mapping(address => uint256) public lastFaucet;

    event Listed(address indexed token, string symbol);
    event Prices(uint256 count, uint256 at);
    event Swap(address indexed user, address indexed by, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 valueUsd);
    event AgentSet(address indexed user, address indexed agent, uint256 maxTradeUsd, uint256 maxDayUsd, uint256 expiry);
    event AgentRevoked(address indexed user, address indexed agent);
    event Faucet(address indexed user, uint256 amount);

    error NotOwner();
    error NotKeeper();
    error NotListed();
    error SameToken();
    error StalePrice(address token);
    error Slippage(uint256 out, uint256 minOut);
    error BadWeights();
    error NoPolicy();
    error PolicyExpired();
    error OverTradeLimit(uint256 valueUsd, uint256 limit);
    error OverDayLimit(uint256 spent, uint256 limit);
    error FaucetCooldown(uint256 nextAt);
    error ZeroAmount();

    constructor(address keeper_) {
        owner = msg.sender;
        keeper = keeper_;
    }

    // ------------------------------------------------------------------ admin

    function setKeeper(address k) external {
        if (msg.sender != owner) revert NotOwner();
        keeper = k;
    }

    function setUsd(TestToken t) external {
        if (msg.sender != owner) revert NotOwner();
        usd = t;
    }

    function list(TestToken t) external {
        if (msg.sender != owner) revert NotOwner();
        if (!listed[address(t)]) {
            listed[address(t)] = true;
            tokens.push(address(t));
            emit Listed(address(t), t.symbol());
        }
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function setPrices(address[] calldata ts, uint256[] calldata pricesE8) external {
        if (msg.sender != keeper && msg.sender != owner) revert NotKeeper();
        for (uint256 i; i < ts.length; i++) {
            if (!listed[ts[i]]) revert NotListed();
            priceE8[ts[i]] = pricesE8[i];
            priceAt[ts[i]] = block.timestamp;
        }
        emit Prices(ts.length, block.timestamp);
    }

    // ------------------------------------------------------------------ pricing

    function _price(address t) internal view returns (uint256 p) {
        if (!listed[t]) revert NotListed();
        p = priceE8[t];
        if (p == 0 || block.timestamp - priceAt[t] > MAX_AGE) revert StalePrice(t);
    }

    /// @notice USD value (8 decimals) of `amount` of token `t`.
    function valueOf(address t, uint256 amount) public view returns (uint256) {
        return (amount * _price(t)) / (10 ** TestToken(t).decimals());
    }

    /// @notice Output amount (after fee) for a swap.
    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256 out, uint256 valueUsd) {
        if (tokenIn == tokenOut) revert SameToken();
        valueUsd = valueOf(tokenIn, amountIn);
        out = (valueUsd * (10 ** TestToken(tokenOut).decimals())) / _price(tokenOut);
        out -= (out * FEE_BPS) / 10_000;
    }

    // ------------------------------------------------------------------ user swaps

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external returns (uint256 out) {
        out = _swap(msg.sender, msg.sender, tokenIn, tokenOut, amountIn, minOut);
    }

    /// @notice Split `amountIn` of `tokenIn` across several tokens by weight (basis points, sum 10000).
    function swapBasket(
        address tokenIn,
        uint256 amountIn,
        address[] calldata tokensOut,
        uint16[] calldata weightsBps,
        uint256[] calldata minOuts
    ) external returns (uint256[] memory outs) {
        if (tokensOut.length == 0 || tokensOut.length != weightsBps.length || tokensOut.length != minOuts.length) revert BadWeights();
        uint256 sum;
        for (uint256 i; i < weightsBps.length; i++) sum += weightsBps[i];
        if (sum != 10_000) revert BadWeights();
        outs = new uint256[](tokensOut.length);
        uint256 spent;
        for (uint256 i; i < tokensOut.length; i++) {
            uint256 part = i == tokensOut.length - 1 ? amountIn - spent : (amountIn * weightsBps[i]) / 10_000;
            spent += part;
            outs[i] = _swap(msg.sender, msg.sender, tokenIn, tokensOut[i], part, minOuts[i]);
        }
    }

    function faucet() external {
        uint256 next = lastFaucet[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucet[msg.sender] != 0 && block.timestamp < next) revert FaucetCooldown(next);
        lastFaucet[msg.sender] = block.timestamp;
        usd.mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }

    // ------------------------------------------------------------------ agent policy

    function setAgent(address agent, uint128 maxTradeUsd, uint128 maxDayUsd, uint64 expiry) external {
        Policy storage p = policies[msg.sender][agent];
        p.maxTradeUsd = maxTradeUsd;
        p.maxDayUsd = maxDayUsd;
        p.expiry = expiry;
        emit AgentSet(msg.sender, agent, maxTradeUsd, maxDayUsd, expiry);
    }

    function revokeAgent(address agent) external {
        delete policies[msg.sender][agent];
        emit AgentRevoked(msg.sender, agent);
    }

    /// @notice Agent trade on behalf of `user`, within the policy the user set.
    function executeFor(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external returns (uint256 out) {
        Policy storage p = policies[user][msg.sender];
        if (p.expiry == 0) revert NoPolicy();
        if (block.timestamp > p.expiry) revert PolicyExpired();
        uint256 v = valueOf(tokenIn, amountIn);
        if (v > p.maxTradeUsd) revert OverTradeLimit(v, p.maxTradeUsd);
        uint64 today = uint64(block.timestamp / 1 days);
        if (p.day != today) {
            p.day = today;
            p.spentToday = 0;
        }
        if (p.spentToday + v > p.maxDayUsd) revert OverDayLimit(p.spentToday + v, p.maxDayUsd);
        p.spentToday += uint128(v);
        out = _swap(user, msg.sender, tokenIn, tokenOut, amountIn, minOut);
    }

    // ------------------------------------------------------------------ internal

    function _swap(address user, address by, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal returns (uint256 out) {
        if (amountIn == 0) revert ZeroAmount();
        uint256 v;
        (out, v) = quote(tokenIn, tokenOut, amountIn);
        if (out < minOut) revert Slippage(out, minOut);
        TestToken(tokenIn).burn(user, amountIn);
        TestToken(tokenOut).mint(user, out);
        emit Swap(user, by, tokenIn, tokenOut, amountIn, out, v);
    }
}
