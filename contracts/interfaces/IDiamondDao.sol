pragma solidity =0.8.17;

import {Proposal, ProposalState, Vote} from "../library/DaoStructs.sol";

interface IDiamondDao {
    event ProposalCreated(
        address indexed proposer,
        uint256 indexed proposalId,
        address[] targets,
        uint256[] values,
        bytes[] calldatas,
        string description
    );

    event ProposalCanceled(
        address indexed proposer,
        uint256 indexed proposalId
    );

    event ProposalExecuted(address indexed caller, uint256 indexed proposalId);

    event SubmitVote(
        address indexed voter,
        uint256 indexed proposalId,
        Vote vote
    );

    event SubmitVoteWithReason(
        address indexed voter,
        uint256 indexed proposalId,
        Vote vote,
        string reason
    );

    error InsufficientFunds();
    error InvalidArgument();
    error OnlyValidators(address caller);
    error ProposalAlreadyExist(uint256 proposalId);
    error ProposalNotExist(uint256 proposalId);
    error TransferFailed(address from, address to, uint256 amount);
    error UnexpectedProposalState(uint256 proposalId, ProposalState state);

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external payable;

    function cancel(uint256 proposalId) external;

    function vote(uint256 proposalId, Vote _vote) external;

    function voteWithReason(
        uint256 proposalId,
        Vote _vote,
        string calldata reason
    ) external;

    function finalize(uint256 proposalId) external;

    function execute(uint256 proposalId) external;

    function proposalExists(uint256 proposalId) external view returns (bool);

    function getProposal(
        uint256 proposalId
    ) external view returns (Proposal memory);

    function countVotes(uint256 proposalId) external;

    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) external pure returns (uint256);
}
