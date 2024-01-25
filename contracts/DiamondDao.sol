// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { AddressUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import { EnumerableSetUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import { IDiamondDao } from "./interfaces/IDiamondDao.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";

import {
    DaoPhase,
    Phase,
    Proposal,
    ProposalState,
    ProposalStatistic,
    Vote,
    VoteRecord,
    VotingResult
} from "./library/DaoStructs.sol"; // prettier-ignore

/// Diamond DAO central point of operation.
/// - Manages the DAO funds.
/// - Is able to upgrade all diamond-contracts-core contracts, including itself.
/// - Is able to vote for chain settings.
contract DiamondDao is IDiamondDao, Initializable, ReentrancyGuardUpgradeable {
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    /// @notice To make sure we don't exceed the gas limit updating status of proposals
    uint256 public constant MAX_NEW_PROPOSALS = 100;
    uint64 public constant DAO_PHASE_DURATION = 14 days;

    address public reinsertPot;
    uint256 public createProposalFee;

    uint256 public governancePot;

    IValidatorSetHbbft public validatorSet;
    IStakingHbbft public stakingHbbft;
    ProposalStatistic public statistic;

    DaoPhase public daoPhase;

    uint256[] public currentPhaseProposals;

    /// @dev Proposal ID to pSeaportroposal data mapping
    mapping(uint256 => Proposal) public proposals;

    /// @dev Proposal voting results mapping
    mapping(uint256 => VotingResult) public results;

    /// @dev proposalId => (voter => vote) mapping
    mapping(uint256 => mapping(address => VoteRecord)) public votes;

    /// @dev daoEpoch => (voter => stakeSnapshot) - Voter stake amount snapshot on voting finalization
    mapping(uint256 => mapping(address => uint256)) public daoEpochStakeSnapshot;

    /// @dev daoEpoch => voters[] - specific DAO epoch voters (all proposals)
    mapping(uint256 => EnumerableSetUpgradeable.AddressSet) private _daoEpochVoters;

    /// @dev proposal Id => voters[] - specific proposal voters
    mapping(uint256 => EnumerableSetUpgradeable.AddressSet) private _proposalVoters;

    modifier exists(uint256 proposalId) {
        if (!proposalExists(proposalId)) {
            revert ProposalNotExist(proposalId);
        }
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != address(this)) {
            revert OnlyGovernance();
        }
        _;
    }

    modifier onlyPhase(Phase phase) {
        if (daoPhase.phase != phase) {
            revert UnavailableInCurrentPhase(daoPhase.phase);
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

    receive() external payable {
        governancePot += msg.value;
    }

    function initialize(
        address _validatorSet,
        address _stakingHbbft,
        address _reinsertPot,
        uint256 _createProposalFee,
        uint64 _startTimestamp
    ) external initializer {
        if (
            _validatorSet == address(0) ||
            _reinsertPot == address(0) ||
            _stakingHbbft == address(0) ||
            _createProposalFee == 0
        ) {
            revert InvalidArgument();
        }

        if (_startTimestamp < block.timestamp) {
            revert InvalidStartTimestamp();
        }

        __ReentrancyGuard_init();

        validatorSet = IValidatorSetHbbft(_validatorSet);
        stakingHbbft = IStakingHbbft(_stakingHbbft);
        reinsertPot = _reinsertPot;
        createProposalFee = _createProposalFee;

        daoPhase.start = _startTimestamp;
        daoPhase.end = _startTimestamp + DAO_PHASE_DURATION;
        daoPhase.phase = Phase.Proposal;
        daoPhase.daoEpoch = 1;
    }

    function setCreateProposalFee(uint256 _fee) external onlyGovernance {
        if (_fee == 0) {
            revert InvalidArgument();
        }

        createProposalFee = _fee;

        emit SetCreateProposalFee(_fee);
    }

    function switchPhase() external {
        if (block.timestamp < daoPhase.end) {
            return;
        }

        Phase newPhase = daoPhase.phase == Phase.Proposal ? Phase.Voting : Phase.Proposal;

        uint64 newPhaseStart = daoPhase.end + 1;
        daoPhase.start = newPhaseStart;
        daoPhase.end = newPhaseStart + DAO_PHASE_DURATION;
        daoPhase.phase = newPhase;

        ProposalState stateToSet = newPhase == Phase.Voting
            ? ProposalState.Active
            : ProposalState.VotingFinished;

        bool snapshotStakes = stateToSet == ProposalState.VotingFinished;

        for (uint256 i = 0; i < currentPhaseProposals.length; ++i) {
            uint256 proposalId = currentPhaseProposals[i];

            proposals[proposalId].state = stateToSet;

            if (snapshotStakes) {
                proposals[proposalId].votingDaoEpoch = daoPhase.daoEpoch;
            }
        }

        if (snapshotStakes) {
            _snapshotStakes(daoPhase.daoEpoch);

            daoPhase.daoEpoch += 1;
        }

        if (newPhase == Phase.Proposal) {
            delete currentPhaseProposals;
        }

        emit SwitchDaoPhase(daoPhase.phase, daoPhase.start, daoPhase.end);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external payable onlyPhase(Phase.Proposal) {
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

        if (currentPhaseProposals.length >= MAX_NEW_PROPOSALS) {
            revert NewProposalsLimitExceeded();
        }

        uint256 proposalId = hashProposal(targets, values, calldatas, description);

        if (proposalExists(proposalId)) {
            revert ProposalAlreadyExist(proposalId);
        }

        address proposer = msg.sender;

        Proposal storage proposal = proposals[proposalId];

        proposal.proposer = proposer;
        proposal.state = ProposalState.Created;
        proposal.targets = targets;
        proposal.values = values;
        proposal.calldatas = calldatas;
        proposal.description = description;

        currentPhaseProposals.push(proposalId);
        statistic.total += 1;

        _transfer(reinsertPot, msg.value);

        emit ProposalCreated(proposer, proposalId, targets, values, calldatas, description);
    }

    function cancel(uint256 proposalId, string calldata reason) external exists(proposalId) {
        Proposal storage proposal = proposals[proposalId];

        if (msg.sender != proposal.proposer) {
            revert OnlyProposer();
        }

        _requireState(proposalId, ProposalState.Created);

        proposal.state = ProposalState.Canceled;
        statistic.canceled += 1;

        emit ProposalCanceled(msg.sender, proposalId, reason);
    }

    function vote(
        uint256 proposalId,
        Vote _vote
    ) external exists(proposalId) onlyPhase(Phase.Voting) onlyValidator {
        address voter = msg.sender;

        // Proposal must have Active state, checked in _submitVote
        _submitVote(voter, proposalId, _vote, "");

        emit SubmitVote(voter, proposalId, _vote);
    }

    function voteWithReason(
        uint256 proposalId,
        Vote _vote,
        string calldata reason
    ) external exists(proposalId) onlyPhase(Phase.Voting) onlyValidator {
        address voter = msg.sender;

        // Proposal must have Active state, checked in _submitVote
        _submitVote(voter, proposalId, _vote, reason);

        emit SubmitVoteWithReason(voter, proposalId, _vote, reason);
    }

    function finalize(uint256 proposalId) external exists(proposalId) {
        _requireState(proposalId, ProposalState.VotingFinished);

        Proposal storage proposal = proposals[proposalId];
        VotingResult memory result = _countVotes(proposalId, true);

        _saveVotingResult(proposalId, result);

        bool accepted = quorumReached(result);

        proposal.state = accepted ? ProposalState.Accepted : ProposalState.Declined;

        if (accepted) {
            statistic.accepted += 1;
        } else {
            statistic.declined += 1;
        }

        emit VotingFinalized(msg.sender, proposalId, accepted);
    }

    function execute(uint256 proposalId) external nonReentrant exists(proposalId) {
        _requireState(proposalId, ProposalState.Accepted);

        Proposal storage proposal = proposals[proposalId];

        proposal.state = ProposalState.Executed;

        _executeOperations(proposal.targets, proposal.values, proposal.calldatas);

        emit ProposalExecuted(msg.sender, proposalId);
    }

    function getCurrentPhaseProposals() external view returns (uint256[] memory) {
        return currentPhaseProposals;
    }

    function getProposalVotersCount(uint256 proposalId) external view returns (uint256) {
        return _proposalVoters[proposalId].length();
    }

    function getProposalVoters(uint256 proposalId) public view returns (address[] memory) {
        return _proposalVoters[proposalId].values();
    }

    function proposalExists(uint256 proposalId) public view returns (bool) {
        return proposals[proposalId].proposer != address(0);
    }

    function getProposal(uint256 proposalId) public view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function countVotes(
        uint256 proposalId
    ) external view exists(proposalId) returns (VotingResult memory) {
        ProposalState state = proposals[proposalId].state;

        if (
            state == ProposalState.Accepted ||
            state == ProposalState.Declined ||
            state == ProposalState.Executed
        ) {
            return results[proposalId];
        } else if (state == ProposalState.VotingFinished) {
            return _countVotes(proposalId, true);
        } else if (state == ProposalState.Active) {
            return _countVotes(proposalId, false);
        } {
            revert UnexpectedProposalState(proposalId, state);
        }
    }

    function _countVotes(uint256 proposalId, bool useSnapshot) private view returns (VotingResult memory) {
        uint64 daoEpoch = proposals[proposalId].votingDaoEpoch;

        VotingResult memory result;

        address[] memory voters = getProposalVoters(proposalId);

        for (uint256 i = 0; i < voters.length; ++i) {
            address voter = voters[i];

            uint256 stakeAmount = 0;

            if (useSnapshot) {
                stakeAmount = daoEpochStakeSnapshot[daoEpoch][voter];
            } else {
                stakeAmount = stakingHbbft.stakeAmountTotal(voter);
            }

            Vote _vote = votes[proposalId][voter].vote;

            if (_vote == Vote.Yes) {
                result.countYes += 1;
                result.stakeYes += stakeAmount;
            } else if (_vote == Vote.No) {
                result.countNo += 1;
                result.stakeNo += stakeAmount;
            } else {
                result.countAbstain += 1;
                result.stakeAbstain += stakeAmount;
            }
        }

        return result;
    }

    function quorumReached(VotingResult memory result) public pure returns (bool) {
        uint256 totalVotedStake = result.stakeYes + result.stakeNo + result.stakeAbstain;
        uint256 acceptanceThreshold = (totalVotedStake * 2) / 3;

        return result.stakeYes >= acceptanceThreshold;
    }

    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public pure virtual returns (uint256) {
        bytes32 descriptionHash = keccak256(bytes(description));

        return uint256(keccak256(abi.encode(targets, values, calldatas, descriptionHash)));
    }

    function _snapshotStakes(uint64 daoEpoch) private {
        address[] memory daoEpochVoters = _daoEpochVoters[daoEpoch].values();

        for (uint256 i = 0; i < daoEpochVoters.length; ++i) {
            address voter = daoEpochVoters[i];
            uint256 stakeAmount = stakingHbbft.stakeAmountTotal(voter);

            daoEpochStakeSnapshot[daoEpoch][voter] = stakeAmount;
        }
    }

    function _submitVote(
        address voter,
        uint256 proposalId,
        Vote _vote,
        string memory reason
    ) private {
        _requireState(proposalId, ProposalState.Active);

        _daoEpochVoters[daoPhase.daoEpoch].add(voter);
        _proposalVoters[proposalId].add(voter);

        votes[proposalId][voter] = VoteRecord({
            timestamp: uint64(block.timestamp),
            vote: _vote,
            reason: reason
        });
    }

    function _saveVotingResult(uint256 proposalId, VotingResult memory res) private {
        VotingResult storage result = results[proposalId];

        result.countAbstain = res.countAbstain;
        result.countNo = res.countNo;
        result.countYes = res.countYes;
        result.stakeAbstain = res.stakeAbstain;
        result.stakeNo = res.stakeNo;
        result.stakeYes = res.stakeYes;
    }

    function _executeOperations(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) private {
        for (uint256 i = 0; i < targets.length; ++i) {
            (bool success, bytes memory returndata) = targets[i].call{ value: values[i] }(
                calldatas[i]
            );
            AddressUpgradeable.verifyCallResult(success, returndata, "low-level call failed");

            if (values[i] != 0) {
                governancePot -= values[i];
            }
        }
    }

    function _transfer(address recipient, uint256 amount) private {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = recipient.call{ value: amount }("");
        if (!success) {
            revert TransferFailed(address(this), recipient, amount);
        }
    }

    function _requireState(uint256 _proposalId, ProposalState _state) private view {
        ProposalState state = getProposal(_proposalId).state;

        if (state != _state) {
            revert UnexpectedProposalState(_proposalId, state);
        }
    }

    function _isValidator(address stakingAddress) private view returns (bool) {
        address miningAddress = validatorSet.miningByStakingAddress(stakingAddress);

        return
            miningAddress != address(0) && validatorSet.validatorAvailableSince(miningAddress) != 0;
    }
}
