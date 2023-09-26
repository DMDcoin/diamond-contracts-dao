pragma solidity =0.8.17;

interface IValidatorSetHbbft {
    function isValidator(address) external view returns (bool);

    function miningByStakingAddress(address) external view returns (address);

    function validatorAvailableSince(address) external view returns (uint256);
}
