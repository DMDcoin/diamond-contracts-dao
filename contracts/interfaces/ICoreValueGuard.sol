// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

interface ICoreValueGuard {
    error OutOfAllowedRange();

    function isWithinAllowedRange(bytes4 funcSelector, uint256 newVal) external view returns(bool);
}
