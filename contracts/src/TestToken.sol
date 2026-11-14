// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title BCIO test token
/// @notice ERC-20 for the BCIO testnet desk (tUSDC, tNVDA, tBTC ...). No real value.
///         Only the desk can mint and burn; it does so when users swap.
contract TestToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    address public immutable desk;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error OnlyDesk();
    error Insufficient();

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address desk_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        desk = desk_;
    }

    modifier onlyDesk() {
        if (msg.sender != desk) revert OnlyDesk();
        _;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < value) revert Insufficient();
            allowance[from][msg.sender] = a - value;
        }
        _move(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external onlyDesk {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    /// @dev The desk only calls this for the swapper itself, or for a user whose
    ///      agent policy allows the trade (see BcioDesk.executeFor).
    function burn(address from, uint256 value) external onlyDesk {
        if (balanceOf[from] < value) revert Insufficient();
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    function _move(address from, address to, uint256 value) internal {
        if (balanceOf[from] < value) revert Insufficient();
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
