// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

enum ProposalState {
    Created,
    Active,
    Canceled,
    Accepted,
    Declined,
    Executed
}

enum Vote {
    Abstain,
    No,
    Yes
}

enum Phase {
    Proposal,
    Voting
}

struct DaoPhase {
    uint64 start;
    uint64 end;
    Phase phase;
}

struct VoteRecord {
    uint64 timestamp;
    Vote vote;
    string reason;
}

struct VotingResult {
    uint64 countAbstain;
    uint64 countYes;
    uint64 countNo;
    uint256 stakeAbstain;
    uint256 stakeYes;
    uint256 stakeNo;
}

struct Proposal {
    address proposer;
    ProposalState state;
    address[] targets;
    uint256[] values;
    bytes[] calldatas;
    string description;
}

struct ProposalStatistic {
    uint64 total;
    uint64 accepted;
    uint64 declined;
    uint64 canceled;
}
