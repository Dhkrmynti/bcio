// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// Uniswap SwapRouter02 (IV3SwapRouter): exactInputSingle has no deadline field.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title BCIO agent permissions (Robinhood Chain mainnet)
/// @notice Lets a user give an AI agent narrow, revocable trading rights over their OWN wallet.
///
///  Non-custodial: tokens stay in the user's wallet. For each trade the contract pulls `amountIn`
///  from the user, swaps it on Uniswap v3 and sends the output straight back to the user in the
///  same transaction. Nothing is ever held between transactions and no one (agent, owner, BCIO)
///  can send a user's tokens to any other address.
///
///  What the user controls (setAgent):
///   - which tokens the agent may trade (every trade is token <-> USDG),
///   - max USD per trade and per UTC day, an expiry,
///   - the max price deviation from Chainlink the agent may accept (swap reverts otherwise).
///  revokeAgent ends it at once. Token approvals are separate ERC-20 approvals the user can lower
///  to zero at any time.
///
///  What the owner controls: the list of tradable tokens (token, Chainlink feed, staleness limit,
///  Uniswap pool fee) and nothing else. The router and USDG are fixed at deployment. A token the
///  owner lists is only tradable for users who explicitly allowed it in their own policy.
contract BcioAgent {
    uint16 public constant MAX_DEVIATION_BPS = 2_000; // 20%: hard ceiling on what a user can allow

    struct Market {
        address feed; // Chainlink USD feed
        uint32 maxAge; // seconds; stock feeds pause on weekends/holidays, so they get a longer window
        uint24 fee; // Uniswap v3 pool fee tier for token/USDG
        bool listed;
    }

    struct Policy {
        uint64 maxTradeUsd; // USDG units (6 decimals)
        uint64 maxDayUsd; // USDG units (6 decimals)
        uint64 expiry;
        uint32 day;
        uint16 maxDeviationBps;
        uint64 spentToday; // USDG units
    }

    address public owner;
    address public pendingOwner;
    ISwapRouter02 public immutable router;
    address public immutable usd; // USDG
    uint8 private immutable usdDecimals;

    mapping(address => Market) public markets;
    address[] public tokens;
    mapping(address => mapping(address => Policy)) public policies; // user => agent => policy
    mapping(address => mapping(address => mapping(address => bool))) public allowedToken; // user => agent => token
    uint256 private locked = 1;

    event Listed(address indexed token, address feed, uint32 maxAge, uint24 fee);
    event Delisted(address indexed token);
    event AgentSet(
        address indexed user, address indexed agent, uint256 maxTradeUsd, uint256 maxDayUsd, uint256 expiry, uint256 maxDeviationBps, address[] tokens
    );
    event AgentRevoked(address indexed user, address indexed agent);
    event AgentTrade(
        address indexed user, address indexed agent, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 valueUsd
    );
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error Reentrancy();
    error NotListed(address token);
    error BadFeed(address token);
    error StalePrice(address token, uint256 updatedAt);
    error NotUsdPair();
    error TokenNotAllowed(address token);
    error NoPolicy();
    error PolicyExpired();
    error BadPolicy();
    error OverTradeLimit(uint256 valueUsd, uint256 limit);
    error OverDayLimit(uint256 spent, uint256 limit);
    error ZeroAmount();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(ISwapRouter02 router_, address usd_, address usdFeed, uint32 usdMaxAge) {
        owner = msg.sender;
        router = router_;
        usd = usd_;
        usdDecimals = IERC20(usd_).decimals();
        markets[usd_] = Market(usdFeed, usdMaxAge, 0, true);
        emit Listed(usd_, usdFeed, usdMaxAge, 0);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------------ owner: listings only

    function list(address token, address feed, uint32 maxAge, uint24 fee) external onlyOwner {
        if (token == usd) revert NotUsdPair();
        if (IAggregatorV3(feed).decimals() == 0) revert BadFeed(token);
        if (!markets[token].listed) tokens.push(token);
        markets[token] = Market(feed, maxAge, fee, true);
        emit Listed(token, feed, maxAge, fee);
    }

    function delist(address token) external onlyOwner {
        markets[token].listed = false;
        emit Delisted(token);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    // ------------------------------------------------------------------ prices

    /// @notice Chainlink USD price of `token`, scaled to 1e18.
    function priceE18(address token) public view returns (uint256) {
        Market memory m = markets[token];
        if (!m.listed) revert NotListed(token);
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(m.feed).latestRoundData();
        if (answer <= 0) revert BadFeed(token);
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > m.maxAge) revert StalePrice(token, updatedAt);
        return uint256(answer) * 10 ** (18 - IAggregatorV3(m.feed).decimals());
    }

    /// @notice Oracle value of `amount` of `token`, in USDG units.
    function valueUsd(address token, uint256 amount) public view returns (uint256) {
        uint8 d = IERC20(token).decimals();
        return (amount * priceE18(token) * 10 ** usdDecimals) / (10 ** d) / 1e18;
    }

    /// @notice Oracle-fair output for a swap, before any deviation allowance.
    function fairOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint256 v18 = (amountIn * priceE18(tokenIn)) / (10 ** IERC20(tokenIn).decimals()); // USD, 1e18
        return (v18 * (10 ** IERC20(tokenOut).decimals())) / priceE18(tokenOut);
    }

    // ------------------------------------------------------------------ user: policy

    function setAgent(
        address agent,
        uint64 maxTradeUsd,
        uint64 maxDayUsd,
        uint64 expiry,
        uint16 maxDeviationBps,
        address[] calldata allowTokens
    ) external {
        if (
            agent == address(0) || maxTradeUsd == 0 || maxDayUsd < maxTradeUsd || expiry <= block.timestamp
                || maxDeviationBps == 0 || maxDeviationBps > MAX_DEVIATION_BPS
        ) revert BadPolicy();
        Policy storage p = policies[msg.sender][agent];
        p.maxTradeUsd = maxTradeUsd;
        p.maxDayUsd = maxDayUsd;
        p.expiry = expiry;
        p.maxDeviationBps = maxDeviationBps;
        // tokens from an earlier policy stay allowed only if listed again here
        for (uint256 i; i < tokens.length; i++) {
            allowedToken[msg.sender][agent][tokens[i]] = false;
        }
        for (uint256 i; i < allowTokens.length; i++) {
            if (!markets[allowTokens[i]].listed || allowTokens[i] == usd) revert NotListed(allowTokens[i]);
            allowedToken[msg.sender][agent][allowTokens[i]] = true;
        }
        emit AgentSet(msg.sender, agent, maxTradeUsd, maxDayUsd, expiry, maxDeviationBps, allowTokens);
    }

    function revokeAgent(address agent) external {
        delete policies[msg.sender][agent];
        for (uint256 i; i < tokens.length; i++) {
            allowedToken[msg.sender][agent][tokens[i]] = false;
        }
        emit AgentRevoked(msg.sender, agent);
    }

    // ------------------------------------------------------------------ agent: trade

    /// @notice Agent trade on behalf of `user`: token -> USDG or USDG -> token, within the user's policy.
    /// @param minOut the agent's own floor; the contract also enforces the oracle floor and uses the higher.
    function executeFor(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 out)
    {
        if (amountIn == 0) revert ZeroAmount();
        if ((tokenIn == usd) == (tokenOut == usd)) revert NotUsdPair();
        address token = tokenIn == usd ? tokenOut : tokenIn;
        Market memory m = markets[token];
        if (!m.listed) revert NotListed(token);

        Policy storage p = policies[user][msg.sender];
        if (p.expiry == 0) revert NoPolicy();
        if (block.timestamp > p.expiry) revert PolicyExpired();
        if (!allowedToken[user][msg.sender][token]) revert TokenNotAllowed(token);

        // limits in USD (oracle value of what goes in)
        uint256 v = valueUsd(tokenIn, amountIn);
        if (v > p.maxTradeUsd) revert OverTradeLimit(v, p.maxTradeUsd);
        uint32 today = uint32(block.timestamp / 1 days);
        if (p.day != today) {
            p.day = today;
            p.spentToday = 0;
        }
        if (p.spentToday + v > p.maxDayUsd) revert OverDayLimit(p.spentToday + v, p.maxDayUsd);
        p.spentToday += uint64(v);

        // price floor: oracle-fair output minus the deviation the user allowed
        uint256 floor = (fairOut(tokenIn, tokenOut, amountIn) * (10_000 - p.maxDeviationBps)) / 10_000;
        if (minOut > floor) floor = minOut;

        _pull(tokenIn, user, amountIn);
        _approve(tokenIn, address(router), amountIn);
        out = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: m.fee,
                recipient: user,
                amountIn: amountIn,
                amountOutMinimum: floor,
                sqrtPriceLimitX96: 0
            })
        );
        _approve(tokenIn, address(router), 0);
        emit AgentTrade(user, msg.sender, tokenIn, tokenOut, amountIn, out, v);
    }

    // ------------------------------------------------------------------ internal (safe ERC-20)

    function _pull(address token, address from, uint256 amount) private {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSelector(0x23b872dd, from, address(this), amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }

    function _approve(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }
}
