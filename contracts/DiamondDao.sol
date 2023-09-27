// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import {IDiamondDao} from "./interfaces/IDiamondDao.sol";
import {IValidatorSetHbbft} from "./interfaces/IValidatorSetHbbft.sol";
import {Proposal, ProposalState, ProposalStatistic, Vote, VoteRecord} from "./library/DaoStructs.sol";

/// Diamond DAO central point of operation.
/// - Manages the DAO funds.
/// - Is able to upgrade all diamond-contracts-core contracts, including itself.
/// - Is able to vote for chain settings.
contract DiamondDao is IDiamondDao, Initializable {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    uint256 public constant PROPOSE_PHASE_DURATION = 14 days;
    uint256 public constant VOTING_PHASE_DURATION = 14 days;

    address public reinsertPot;
    uint256 public createProposalFee;
    IValidatorSetHbbft public validatorSet;

    ProposalStatistic public statistic;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => VoteRecord)) public votes;
    mapping(uint256 => EnumerableSetUpgradeable.AddressSet)
        private _proposalVoters;

    modifier exists(uint256 proposalId) {
        if (proposalExists(proposalId)) {
            revert ProposalNotExist(proposalId);
        }
        _;
    }

    modifier onlyValidator() {
        if (!_isValidator(msg.sender)) {
            revert OnlyValidators(msg.sender);
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    function initialize(
        address _validatorSet,
        address _reinsertPot,
        uint256 _createProposalFee
    ) external initializer {
        if (
            _validatorSet == address(0) ||
            _reinsertPot == address(0) ||
            _createProposalFee == 0
        ) {
            revert InvalidArgument();
        }

        validatorSet = IValidatorSetHbbft(_validatorSet);
        reinsertPot = _reinsertPot;
        createProposalFee = _createProposalFee;
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external payable {
        if (
            targets.length != values.length ||
            targets.length != calldatas.length ||
            targets.length == 0
        ) {
            revert InvalidArgument();
        }

        if (msg.value != createProposalFee) {
            revert InsufficientFunds();
        }

        uint256 proposalId = hashProposal(
            targets,
            values,
            calldatas,
            keccak256(bytes(description))
        );

        if (proposalExists(proposalId)) {
            revert ProposalAlreadyExist(proposalId);
        }

        address proposer = msg.sender;

        proposals[proposalId] = Proposal({
            proposer: proposer,
            state: ProposalState.Created,
            targets: targets,
            values: values,
            calldatas: calldatas,
            description: description
        });

        statistic.total += 1;

        _transferNative(reinsertPot, msg.value);

        emit ProposalCreated(
            proposer,
            proposalId,
            targets,
            values,
            calldatas,
            description
        );
    }

    function cancel(
        uint256 proposalId,
        string calldata reason
    ) external exists(proposalId) {
        _requireState(proposalId, ProposalState.Created);

        Proposal storage proposal = proposals[proposalId];

        if (msg.sender != proposal.proposer) {
            revert OnlyProposer();
        }

        proposal.state = ProposalState.Canceled;
        statistic.canceled += 1;

        emit ProposalCanceled(msg.sender, proposalId, reason);
    }

    function vote(
        uint256 proposalId,
        Vote _vote
    ) external exists(proposalId) onlyValidator {
        address voter = msg.sender;

        _submitVote(voter, proposalId, _vote, "");

        emit SubmitVote(voter, proposalId, _vote);
    }

    function voteWithReason(
        uint256 proposalId,
        Vote _vote,
        string calldata reason
    ) external exists(proposalId) onlyValidator {
        address voter = msg.sender;

        _submitVote(voter, proposalId, _vote, reason);

        emit SubmitVoteWithReason(voter, proposalId, _vote, reason);
    }

    function finalize(uint256 proposalId) external exists(proposalId) {
        bool accepted = true;

        if (accepted) {
            statistic.accepted += 1;
        } else {
            statistic.declined += 1;
        }
    }

    function execute(uint256 proposalId) external exists(proposalId) {
        _requireState(proposalId, ProposalState.Accepted);

        Proposal storage proposal = proposals[proposalId];

        proposal.state = ProposalState.Executed;

        _executeOperations(
            proposal.targets,
            proposal.values,
            proposal.calldatas
        );

        emit ProposalExecuted(msg.sender, proposalId);
    }

    function getProposalVotersCount(
        uint256 proposalId
    ) external view returns (uint256) {
        return _proposalVoters[proposalId].length();
    }

    function getProposalVoters(
        uint256 proposalId
    ) external view returns (address[] memory) {
        return _proposalVoters[proposalId].values();
    }

    function countVotes(uint256 proposalId) public {}

    function proposalExists(uint256 proposalId) public view returns (bool) {
        return proposals[proposalId].proposer != address(0);
    }

    function getProposal(
        uint256 proposalId
    ) public view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public pure virtual returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(targets, values, calldatas, descriptionHash)
                )
            );
    }

    function _submitVote(
        address voter,
        uint256 proposalId,
        Vote _vote,
        string memory reason
    ) private {
        _requireState(proposalId, ProposalState.Active);

        _proposalVoters[proposalId].add(voter);
        votes[proposalId][voter] = VoteRecord({
            voter: voter,
            timestamp: uint64(block.timestamp),
            vote: _vote,
            reason: reason
        });
    }

    function _executeOperations(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) private {
        for (uint256 i = 0; i < targets.length; ++i) {
            (bool success, bytes memory returndata) = targets[i].call{
                value: values[i]
            }(calldatas[i]);
            AddressUpgradeable.verifyCallResult(
                success,
                returndata,
                "low-level call failed"
            );
        }
    }

    function _transferNative(address recipient, uint256 amount) private {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert TransferFailed(address(this), recipient, amount);
        }
    }

    function _requireState(
        uint256 _proposalId,
        ProposalState _state
    ) private view {
        ProposalState state = getProposal(_proposalId).state;

        if (state != _state) {
            revert UnexpectedProposalState(_proposalId, state);
        }
    }

    function _isValidator(address stakingAddress) private view returns (bool) {
        address miningAddress = validatorSet.miningByStakingAddress(
            stakingAddress
        );

        return
            miningAddress != address(0) &&
            validatorSet.validatorAvailableSince(miningAddress) != 0;
    }

    /// this list would go on forever,
    /// bUt all usual ballots like TransferErc20, TransferERC721
    /// are already solved in implementations of (gnosis) global safe.
    /// here we could use multisend.
}
