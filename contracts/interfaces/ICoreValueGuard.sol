// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

interface ICoreValueGuard {
    struct ParameterRange {
        bytes4 getter;
        uint256[] range;
    }

    function isWithinAllowedRange(bytes4 funcSelector, uint256 newVal) external view returns(bool);
    function getAllowedParamsRangeWithSelector(bytes4 funcSelector) external view returns(ParameterRange memory);
}
