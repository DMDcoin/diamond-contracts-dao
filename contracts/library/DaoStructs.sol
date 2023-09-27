// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

enum ProposalState {
    Created,
    Active,
    Canceled,
    Accepted,
    Declined,
    Expired,
    Executed
}

enum Vote {
    Abstain,
    No,
    Yes
}

struct VoteRecord {
    address voter;
    uint64 timestamp;
    Vote vote;
    string reason;
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
