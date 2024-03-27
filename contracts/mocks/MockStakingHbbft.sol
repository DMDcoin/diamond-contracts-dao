// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

import { IStakingHbbft } from "../interfaces/IStakingHbbft.sol";

contract MockStakingHbbft is IStakingHbbft {
    uint256 public delegatorMinStake = 100 ether;
    mapping(address => uint256) private _stakeAmountTotal;

    constructor() {}

    function setStake(address staking, uint256 stakeAmount) external {
        _stakeAmountTotal[staking] = stakeAmount;
    }

    function stakeAmountTotal(address staking) external view returns (uint256) {
        return _stakeAmountTotal[staking];
    }

    function setDelegatorMinStake(uint256 _minStake)
        external
    {
        delegatorMinStake = _minStake;
    }
}
