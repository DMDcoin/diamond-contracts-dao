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
    uint64 open;
    uint64 accepted;
    uint64 declined;
}
