// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

import { IValidatorSetHbbft } from "../interfaces/IValidatorSetHbbft.sol";

contract MockValidatorSetHbbft is IValidatorSetHbbft {
    mapping(address => address) private _stakingToMining;
    mapping(address => bool) private _isValidator;
    mapping(address => bool) private _availability;

    receive() external payable {
        revert();
    }

    constructor() {}

    function add(address staking, address mining, bool available) external {
        _isValidator[mining] = true;
        _stakingToMining[staking] = mining;
        _availability[mining] = available;
    }

    function remove(address staking) external {
        address mining = _stakingToMining[staking];

        delete _isValidator[mining];
        delete _availability[mining];
        delete _stakingToMining[staking];
    }

    function toggleAvailability(address staking, bool available) external {
        address mining = _stakingToMining[staking];

        _availability[mining] = available;
    }

    function isValidator(address mining) external view returns (bool) {
        return _isValidator[mining];
    }

    function miningByStakingAddress(address staking) external view returns (address) {
        return _stakingToMining[staking];
    }

    function validatorAvailableSince(address mining) external view returns (uint256) {
        return _availability[mining] ? block.number : 0;
    }
}
