// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

import { IStakingHbbft } from "../interfaces/IStakingHbbft.sol";

contract MockValidatorSetHbbft is IStakingHbbft {
    mapping(address => uint256) private _stakeAmountTotal;

    constructor() {}

    function setStake(address staking, uint256 stakeAmount) external {
        _stakeAmountTotal[staking] = stakeAmount;
    }

    function stakeAmountTotal(address staking) external view returns (uint256) {
        return _stakeAmountTotal[staking];
    }
}
