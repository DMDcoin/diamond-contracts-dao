// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { ERC721HolderUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";
import { ERC1155HolderUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";

import { IDiamondDaoLowMajority } from "./interfaces/IDiamondDaoLowMajority.sol";

import { VotingResult } from "./library/DaoStructs.sol";
import { InvalidArgument, OnlyGovernance } from "./library/Errors.sol";
import { QuorumCalculator } from "./library/QuorumCalculator.sol";

contract DiamondDaoLowMajority is
    IDiamondDaoLowMajority,
    Initializable,
    ReentrancyGuardUpgradeable,
    ERC721HolderUpgradeable,
    ERC1155HolderUpgradeable
{
    using QuorumCalculator for VotingResult;

    uint256 public lowMajorityPot;

    address public mainDao;

    event LowMajorityProposalExecuted(uint256 proposalId);

    modifier onlyGovernance() {
        if (msg.sender != mainDao) {
            revert OnlyGovernance();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    receive() external payable {
        lowMajorityPot += msg.value;
    }

    function initialize(address _mainDao) external initializer {
        if (_mainDao == address(0)) {
            revert InvalidArgument();
        }

        __ReentrancyGuard_init();

        // Include holder contracts to support NFT's safeTransfer functions
        __ERC721Holder_init();
        __ERC1155Holder_init();

        mainDao = _mainDao;
    }

    function execute(
        uint256 proposalId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external nonReentrant onlyGovernance {
        for (uint256 i = 0; i < targets.length; ++i) {
            uint256 value = values[i];

            (bool success, bytes memory returndata) = targets[i].call{ value: values[i] }(
                calldatas[i]
            );

            Address.verifyCallResult(success, returndata);

            lowMajorityPot -= value;
        }

        emit LowMajorityProposalExecuted(proposalId);
    }

    function quorumReached(
        VotingResult memory result,
        uint256 totalStakedAmount
    ) external pure returns (bool) {
        return result.lowMajorityQuorum(totalStakedAmount);
    }
}
