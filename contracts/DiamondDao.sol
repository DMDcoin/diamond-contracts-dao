// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { Address } from '@openzeppelin/contracts/utils/Address.sol';
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "diamond-contracts-core/contracts/lib/ValueGuards.sol";
import { IDiamondDao } from "./interfaces/IDiamondDao.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { ICoreValueGuard } from "./interfaces/ICoreValueGuard.sol";

import {
    DaoPhase,
    Phase,
    Proposal,
    ProposalState,
    ProposalStatistic,
    Vote,
    VoteRecord,
    VotingResult,
    ProposalType
} from "./library/DaoStructs.sol"; // prettier-ignore

/// Diamond DAO central point of operation.
/// - Manages the DAO funds.
/// - Is able to upgrade all diamond-contracts-core contracts, including itself.
/// - Is able to vote for chain settings.
contract DiamondDao is IDiamondDao, Initializable, ReentrancyGuardUpgradeable, ValueGuards {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice To make sure we don't exceed the gas limit updating status of proposals
    uint256 public daoPhaseCount;
    uint256 public constant MAX_NEW_PROPOSALS = 1000;

    ///@dev this is the duration of each DAO phase.
    ///A full DAO cycle consists of 2 phases: Proposal and Voting,
    /// therefore the full cycle duration is double that amount.
    uint64 public constant DAO_PHASE_DURATION = 24 hours;

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

    /// @dev contract address => is core bool
    mapping(address => bool) public isCoreContract;

    /// @dev Proposal voting results mapping
    mapping(uint256 => VotingResult) public results;

    /// @dev proposalId => (voter => vote) mapping
    mapping(uint256 => mapping(address => VoteRecord)) public votes;

    /// @dev daoEpoch => (voter => stakeSnapshot) - Voter stake amount snapshot on voting finalization
    mapping(uint256 => mapping(address => uint256)) public daoEpochStakeSnapshot;

    /// @dev daoEpoch => voters[] - specific DAO epoch voters (all proposals)
    mapping(uint256 => EnumerableSet.AddressSet) private _daoEpochVoters;

    /// @dev proposal Id => voters[] - specific proposal voters
    mapping(uint256 => EnumerableSet.AddressSet) private _proposalVoters;

    /// @dev Count of unfinalized proposals
    uint256 public unfinalizedProposals;

    /// @dev To keep track of the last DAO phase count for unfinalized proposals check
    uint256 public lastDaoPhaseCount;

    /// @dev daoEpoch => totalStakeSnapshot - Total stake amount snapshot on voting finalization
    mapping(uint256 => uint256) public daoEpochTotalStakeSnapshot;

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

    modifier noUnfinalizedProposals() {
        if (unfinalizedProposalsExist()) {
            revert UnfinalizedProposalsExist();
        } else if (lastDaoPhaseCount != daoPhaseCount) {
            lastDaoPhaseCount = daoPhaseCount;
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
        address _contractOwner,
        address _validatorSet,
        address _stakingHbbft,
        address _reinsertPot,
        address _txPermission,
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

        __Ownable_init(_contractOwner);
        __ReentrancyGuard_init();

        validatorSet = IValidatorSetHbbft(_validatorSet);
        stakingHbbft = IStakingHbbft(_stakingHbbft);
        reinsertPot = _reinsertPot;
        createProposalFee = _createProposalFee;

        daoPhase.start = _startTimestamp;
        daoPhase.end = _startTimestamp + DAO_PHASE_DURATION;
        daoPhase.phase = Phase.Proposal;
        daoPhase.daoEpoch = 1;
        daoPhaseCount = 1;

        uint256[] memory createProposalFeeAllowedParams = new uint256[](9);
        createProposalFeeAllowedParams[0] = 10 ether;
        createProposalFeeAllowedParams[1] = 20 ether;
        createProposalFeeAllowedParams[2] = 30 ether;
        createProposalFeeAllowedParams[3] = 40 ether;
        createProposalFeeAllowedParams[4] = 50 ether;
        createProposalFeeAllowedParams[5] = 60 ether;
        createProposalFeeAllowedParams[6] = 70 ether;
        createProposalFeeAllowedParams[7] = 80 ether;
        createProposalFeeAllowedParams[8] = 90 ether;

        __initAllowedChangeableParameter(
            this.setCreateProposalFee.selector,
            this.createProposalFee.selector,
            createProposalFeeAllowedParams
        );

        isCoreContract[address(this)] = true;
        isCoreContract[_stakingHbbft] = true;
        isCoreContract[_txPermission] = true;
        isCoreContract[_reinsertPot] = true;
     }

    function setCreateProposalFee(uint256 _fee) external onlyGovernance withinAllowedRange(_fee) {
        createProposalFee = _fee;

        emit SetCreateProposalFee(_fee);
    }

    function setIsCoreContract(address _add, bool isCore) external onlyGovernance {
        isCoreContract[_add] = isCore;

        emit SetIsCoreContract(_add, isCore);
    }

    function switchPhase() external nonReentrant {
        uint64 currentTimestamp = uint64(block.timestamp);

        if (currentTimestamp < daoPhase.end) {
            return;
        }

        Phase newPhase = daoPhase.phase == Phase.Proposal ? Phase.Voting : Phase.Proposal;

        daoPhase.start = currentTimestamp;
        daoPhase.end = currentTimestamp + DAO_PHASE_DURATION;
        daoPhase.phase = newPhase;

        ProposalState stateToSet = newPhase == Phase.Voting
            ? ProposalState.Active
            : ProposalState.VotingFinished;

        bool snapshotStakes = stateToSet == ProposalState.VotingFinished;

        uint256 proposalsLength = currentPhaseProposals.length;
        for (uint256 i = 0; i < proposalsLength; ++i) {
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
            daoPhaseCount += 1;
            delete currentPhaseProposals;
        }

        emit SwitchDaoPhase(daoPhase.phase, daoPhase.start, daoPhase.end);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory title,
        string memory description,
        string memory discussionUrl
    ) external payable nonReentrant onlyPhase(Phase.Proposal) noUnfinalizedProposals {
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
        
        ProposalType proposalType = _checkProposalType(targets, calldatas);
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
        proposal.title = title;
        proposal.description = description;
        proposal.discussionUrl = discussionUrl;
        proposal.daoPhaseCount = daoPhaseCount;
        proposal.proposalFee = createProposalFee;
        proposal.proposalType = proposalType;

        currentPhaseProposals.push(proposalId);
        statistic.total += 1;
        unfinalizedProposals += 1;

        emit ProposalCreated(proposer, proposalId, targets, values, calldatas, title, description, discussionUrl, createProposalFee);
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

    function finalize(uint256 proposalId) external nonReentrant exists(proposalId) {
        _requireState(proposalId, ProposalState.VotingFinished);

        Proposal storage proposal = proposals[proposalId];
        VotingResult memory result = _countVotes(proposalId, true);

        _saveVotingResult(proposalId, result);

        bool accepted = quorumReached(proposalId, proposal.proposalType, result);

        proposal.state = accepted ? ProposalState.Accepted : ProposalState.Declined;

        if (accepted) {
            statistic.accepted += 1;

            // return fee back to the proposer
            _transfer(proposal.proposer, proposal.proposalFee);
        } else {
            statistic.declined += 1;

            // send fee to the reinsert pot
            _transfer(reinsertPot, proposal.proposalFee);
        }

        unfinalizedProposals -= 1;

        emit VotingFinalized(msg.sender, proposalId, accepted);
    }

    function execute(uint256 proposalId) external nonReentrant exists(proposalId) {
        _requireState(proposalId, ProposalState.Accepted);
        _requireIsExecutable(proposalId);

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
            }
        }

        return result;
    }

    /**
     * @dev Checks if the quorum has been reached for a given proposal type and voting result.
     * @param _type The type of the proposal.
     * @param result The voting result containing the counts of "yes" and "no" votes.
     * @return A boolean indicating whether the quorum has been reached.
     */
    function quorumReached(uint256 proposalId, ProposalType _type, VotingResult memory result) public view returns (bool) {
        uint256 requiredExceeding;
        uint256 totalVotes = _proposalVoters[proposalId].length();

        uint256 daoEpoch = proposals[proposalId].votingDaoEpoch;
        uint256 totalStakedAmount = daoEpochTotalStakeSnapshot[daoEpoch];

        if (_type == ProposalType.ContractUpgrade) {
            requiredExceeding = totalStakedAmount * (50 * 100) / 10000;
        } else {
            requiredExceeding = totalStakedAmount * (33 * 100) / 10000;
        }

        return totalVotes > 0 && result.stakeYes >= result.stakeNo + requiredExceeding;
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

    function unfinalizedProposalsExist() public view returns (bool) {
        if (lastDaoPhaseCount != daoPhaseCount && unfinalizedProposals > 0) {
            return true;
        }
        return false;
    }

    function _snapshotStakes(uint64 daoEpoch) private {
        address[] memory daoEpochVoters = _daoEpochVoters[daoEpoch].values();

        for (uint256 i = 0; i < daoEpochVoters.length; ++i) {
            address voter = daoEpochVoters[i];
            uint256 stakeAmount = stakingHbbft.stakeAmountTotal(voter);
            daoEpochStakeSnapshot[daoEpoch][voter] = stakeAmount;
        }

        daoEpochTotalStakeSnapshot[daoEpoch] = stakingHbbft.totalStakedAmount();
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

        result.countNo = res.countNo;
        result.countYes = res.countYes;
        result.stakeNo = res.stakeNo;
        result.stakeYes = res.stakeYes;
    }

    function _executeOperations(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) private {
        for (uint256 i = 0; i < targets.length; ++i) {
            uint256 execValue = calldatas[i].length == 0 ? values[i] : 0;
            (bool success, bytes memory returndata) = targets[i].call{ value: execValue }(
                calldatas[i]
            );

            Address.verifyCallResult(success, returndata);

            if (execValue != 0) {
                governancePot -= execValue;
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

    function _requireIsExecutable(uint256 _proposalId) private view {
        Proposal memory proposal = getProposal(_proposalId);
        
        if (proposal.daoPhaseCount + 1 != daoPhaseCount) {
            revert OutsideExecutionWindow(_proposalId);
        }

        if (
            proposal.proposalType == ProposalType.ContractUpgrade && proposal.proposer != msg.sender
        ) {
            revert NotProposer(_proposalId, msg.sender);
        }
    }

    function _isValidator(address stakingAddress) private view returns (bool) {
        return stakingHbbft.isPoolValid(stakingAddress);
    }

    /**
     * @dev Extracts the function selector and value from the given call data.
     * @param _data The call data to extract from.
     * @return funcSelector The function selector extracted from the call data.
     * @return value The value extracted from the call data (assuming it's uint256).
     */
    function _extractCallData(bytes memory _data) private pure returns (bytes4 funcSelector, uint256 value) {
        // Extract function selector
        assembly {
            funcSelector := mload(add(_data, 0x20))
        }

        // Extract value from parameter (assuming it's uint256)
        assembly {
            value := mload(add(_data, 0x24))
        }
    }

    /**
     * @dev Returns the type of proposal based on the given targets and calldatas.
     * @param targets The array of target addresses.
     * @param calldatas The array of calldata bytes.
     * @return _type The type of proposal (Open, EcosystemParameterChange, or ContractUpgrade).
     */
    function _checkProposalType(address[] memory targets, bytes[] memory calldatas) private view returns (ProposalType _type) {
        _type = ProposalType.Open;

        for (uint256 i = 0; i < calldatas.length; i++) {
            if (calldatas[i].length == 0) continue;

            (bytes4 setFuncSelector, uint256 newVal) = _extractCallData(calldatas[i]);

            // Perform the low-level call to check if the allowed ranges are defined on the target contract's method.
            // This is done to avoid calling isWithinAllowedRange, which will revert if ranges are not defined.
            // Only for core contracts with defined ranges, the proposal type is set to EcosystemParameterChange.
            // All others are treated as ContractUpgrade by default.
            (bool success, bytes memory result) = targets[i].staticcall(
                abi.encodeWithSelector(
                    ICoreValueGuard(targets[i]).getAllowedParamsRangeWithSelector.selector,
                    setFuncSelector
                )
            );

            if (success && result.length > 0) {
                ICoreValueGuard.ParameterRange memory rangeData = abi.decode(result, (ICoreValueGuard.ParameterRange));

                if (isCoreContract[targets[i]] && rangeData.range.length > 0) {
                    _type = ProposalType.EcosystemParameterChange;

                    if (!ICoreValueGuard(targets[i]).isWithinAllowedRange(setFuncSelector, newVal)) {
                        revert NewValueOutOfRange(newVal);
                    }
                } else {
                    return ProposalType.ContractUpgrade;
                }
            } else {
                // If the call fails, treat it as a ContractUpgrade proposal
                return ProposalType.ContractUpgrade;
            }
        }
    }
}
