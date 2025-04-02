// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { VotingResult } from "../library/DaoStructs.sol";

interface IDiamondDaoLowMajority {
    function execute(
        uint256 proposalId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external;

    function quorumReached(
        VotingResult memory result,
        uint256 totalStakedAmount
    ) external view returns (bool);
}
