// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

interface IStakingHbbft {
    function stakeAmountTotal(address) external view returns (uint256);
    function totalStakedAmount() external view returns (uint256);
}
