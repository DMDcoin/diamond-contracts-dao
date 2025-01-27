// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

enum ProposalState {
    Created,
    Canceled,
    Active,
    VotingFinished,
    Accepted,
    Declined,
    Executed
}

enum Vote {
    No,
    Yes
}

enum Phase {
    Proposal,
    Voting
}

enum ProposalType {
    Open,
    ContractUpgrade,
    EcosystemParameterChange
}

struct DaoPhase {
    uint64 start;
    uint64 end;
    uint64 daoEpoch;
    Phase phase;
}

struct VoteRecord {
    uint64 timestamp;
    Vote vote;
    string reason;
}

struct VotingResult {
    uint64 countYes;
    uint64 countNo;
    uint256 stakeYes;
    uint256 stakeNo;
}

struct Proposal {
    address proposer;
    uint64 votingDaoEpoch;
    ProposalState state;
    address[] targets;
    uint256[] values;
    bytes[] calldatas;
    string title;
    string description;
    string discussionUrl;
    uint256 daoPhaseCount;
    uint256 proposalFee;
    ProposalType proposalType;
}

struct ProposalStatistic {
    uint64 total;
    uint64 accepted;
    uint64 declined;
    uint64 canceled;
}
