// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { Phase, Proposal, ProposalState, Vote } from "../library/DaoStructs.sol";

interface IDiamondDao {
    event ProposalCreated(
        address indexed proposer,
        uint256 indexed proposalId,
        address[] targets,
        uint256[] values,
        bytes[] calldatas,
        string title,
        string description,
        string discussionUrl
    );

    event ProposalCanceled(address indexed proposer, uint256 indexed proposalId, string reason);

    event ProposalExecuted(address indexed caller, uint256 indexed proposalId);

    event VotingFinalized(address indexed caller, uint256 indexed proposalId, bool accepted);

    event SubmitVote(address indexed voter, uint256 indexed proposalId, Vote vote);

    event SubmitVoteWithReason(
        address indexed voter,
        uint256 indexed proposalId,
        Vote vote,
        string reason
    );

    event SwitchDaoPhase(Phase phase, uint256 start, uint256 end);

    event SetCreateProposalFee(uint256 fee);

    event SetIsCoreContract(address contractAddress, bool isCore);

    event SetChangeAbleParameters(bool allowed, string setter, string getter, uint256[] params);

    error InsufficientFunds();
    error InvalidArgument();
    error InvalidStartTimestamp();
    error NewProposalsLimitExceeded();
    error OnlyGovernance();
    error OnlyProposer();
    error OnlyValidators(address caller);
    error ProposalAlreadyExist(uint256 proposalId);
    error ProposalNotExist(uint256 proposalId);
    error TransferFailed(address from, address to, uint256 amount);
    error UnavailableInCurrentPhase(Phase phase);
    error UnexpectedProposalState(uint256 proposalId, ProposalState state);
    error ContractCallFailed(bytes funcSelector, address targetContract);
    error FunctionUpgradeNotAllowed(bytes4 funcSelector, address targetContract);
    error InvalidUpgradeValue(uint256 currentVal, uint256 newVal);
    error UnfinalizedProposalsExist();
    error OutsideExecutionWindow(uint256 proposalId);
    error NotProposer(uint256 proposalId, address caller);

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory title,
        string memory description,
        string memory discussionUrl
    ) external payable;

    function cancel(uint256 proposalId, string calldata reason) external;

    function vote(uint256 proposalId, Vote _vote) external;

    function voteWithReason(uint256 proposalId, Vote _vote, string calldata reason) external;

    function finalize(uint256 proposalId) external;

    function execute(uint256 proposalId) external;

    function proposalExists(uint256 proposalId) external view returns (bool);

    function getProposal(uint256 proposalId) external view returns (Proposal memory);

    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory descriptionHash
    ) external pure returns (uint256);
}
