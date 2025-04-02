// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { VotingResult } from "../library/DaoStructs.sol";
import { QuorumCalculator } from "../library/QuorumCalculator.sol";

contract MockQuorumCalculator {
    using QuorumCalculator for VotingResult;

    function lowMajorityQuorum(
        VotingResult memory vs,
        uint256 totalStakedAmount
    ) external pure returns (bool) {
        return vs.lowMajorityQuorum(totalStakedAmount);
    }

    function highMajorityQuorum(
        VotingResult memory vs,
        uint256 totalStakedAmount
    ) external pure returns (bool) {
        return vs.highMajorityQuorum(totalStakedAmount);
    }
}
