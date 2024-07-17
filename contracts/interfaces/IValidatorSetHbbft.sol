// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

interface IValidatorSetHbbft {
    function isValidator(address) external view returns (bool);

    function isValidatorBanned(address) external view returns (bool);

    function isValidatorOrPending(address) external view returns (bool);

    function miningByStakingAddress(address) external view returns (address);

    function validatorAvailableSince(address) external view returns (uint256);
}
