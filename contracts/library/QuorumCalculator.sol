// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { VotingResult } from "./DaoStructs.sol";

/// @dev we have 2 scenarios here:
/// we either need 1/2 or 1/3 exceeding coins
/// to most common denominator is 6.
/// we need to multiply instead of dividing to avoid floating point numbers
library QuorumCalculator {
    function lowMajorityQuorum(
        VotingResult memory vs,
        uint256 totalStakedAmount
    ) internal pure returns (bool) {
        uint256 requiredExceeding = totalStakedAmount * 2; // 2/6 = 1/3

        return vs.stakeYes * 6 >= vs.stakeNo * 6 + requiredExceeding;
    }

    function highMajorityQuorum(
        VotingResult memory vs,
        uint256 totalStakedAmount
    ) internal pure returns (bool) {
        uint256 requiredExceeding = totalStakedAmount * 3; // 3/6 = 1/2

        return vs.stakeYes * 6 >= vs.stakeNo * 6 + requiredExceeding;
    }
}
