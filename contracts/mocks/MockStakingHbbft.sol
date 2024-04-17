// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

import { IStakingHbbft } from "../interfaces/IStakingHbbft.sol";

contract MockStakingHbbft is IStakingHbbft {
    uint256 public totalStakedAmount;
    uint256 public delegatorMinStake = 100 ether;
    mapping(address => uint256) private _stakeAmountTotal;

    struct ParameterRange {
        bytes4 getter;
        uint256[] range;
    }

    mapping(bytes4 => ParameterRange) public allowedParameterRange;

    /**
     * @dev Emitted when the minimum stake for a delegator is updated.
     * @param minStake The new minimum stake value.
     */
    event SetDelegatorMinStake(uint256 minStake);

    /**
     * @dev Event emitted when changeable parameters are set.
     * @param setter The address of the setter.
     * @param getter The address of the getter.
     * @param params An array of uint256 values representing the parameters.
     */
    event SetChangeAbleParameter(
        string setter,
        string getter,
        uint256[] params
    );

    /**
     * @dev Emitted when changeable parameters are removed.
     * @param funcSelector The function selector of the removed changeable parameters.
     */
    event RemoveChangeAbleParameter(string funcSelector);

    modifier withinAllowedRange(uint256 newVal) {
        require(isWithinAllowedRange(msg.sig, newVal), "new value not within allowed range");
        _;
    }

    constructor() {}

    function setStake(address staking, uint256 stakeAmount) external {
        _stakeAmountTotal[staking] = stakeAmount;
        totalStakedAmount += stakeAmount;
    }

    function stakeAmountTotal(address staking) external view returns (uint256) {
        return _stakeAmountTotal[staking];
    }

    /**
     * @dev Sets the minimum stake required for delegators.
     * @param _minStake The new minimum stake amount.
     * Requirements:
     * - Only the contract owner can call this function.
     * - The stake amount must be within the allowed range.
     */
    function setDelegatorMinStake(uint256 _minStake)
        external
    {
        delegatorMinStake = _minStake;
        emit SetDelegatorMinStake(_minStake);
    }

    /**
     * @dev Sets the allowed changeable parameter for a specific setter function.
     * @param setter The name of the setter function.
     * @param getter The name of the getter function.
     * @param params The array of allowed parameter values.
     * Requirements:
     * - Only the contract owner can call this function.
     */
    function setAllowedChangeableParameter(
        string memory setter,
        string memory getter,
        uint256[] memory params
    ) external {
        allowedParameterRange[bytes4(keccak256(bytes(setter)))] = ParameterRange(
            bytes4(keccak256(bytes(getter))),
            params
        );
        emit SetChangeAbleParameter(setter, getter, params);
    }

    /**
     * @dev Removes the allowed changeable parameter for a given function selector.
     * @param funcSelector The function selector for which the allowed changeable parameter should be removed.
     * Requirements:
     * - Only the contract owner can call this function.
     */
    function removeAllowedChangeableParameter(string memory funcSelector) external {
        delete allowedParameterRange[bytes4(keccak256(bytes(funcSelector)))];
        emit RemoveChangeAbleParameter(funcSelector);
    }

    function isWithinAllowedRange(bytes4 funcSelector, uint256 newVal) public view returns(bool) {
        ParameterRange memory allowedRange = allowedParameterRange[funcSelector];
        if(allowedRange.range.length == 0) return false;
        uint256[] memory range = allowedRange.range;
        uint256 currVal = _getValueWithSelector(allowedRange.getter);
        bool currValFound;

        for (uint256 i = 0; i < range.length; i++) {
            if (range[i] == currVal) {
                currValFound = true;
                uint256 leftVal = (i > 0) ? range[i - 1] : range[0];
                uint256 rightVal = (i < range.length - 1) ? range[i + 1] : range[range.length - 1];
                if (newVal != leftVal && newVal != rightVal) return false;
                break;
            }
        }
        return currValFound;
    }

    function _getValueWithSelector(bytes4 getterSelector) private view returns (uint256) {
        bytes memory payload = abi.encodeWithSelector(getterSelector);
        (bool success, bytes memory result) = address(this).staticcall(payload);
        require(success, "Getter call failed");
        return abi.decode(result, (uint256));
    }
}
