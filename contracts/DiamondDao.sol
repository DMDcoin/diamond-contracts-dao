pragma solidity =0.8.17;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import {IDiamondDao} from "./interfaces/IDiamondDao.sol";
import {Proposal, ProposalState, ProposalStatistic, Vote} from "./library/DaoStructs.sol";

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

    ProposalStatistic public statistic;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => Vote)) public votes;
    mapping(uint256 => EnumerableSetUpgradeable.AddressSet) private _proposalVoters;

    modifier exists(uint256 proposalId) {
        if (proposalExists(proposalId)) {
            revert ProposalNotExist(proposalId);
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    function initialize(
        address _reinsertPot,
        uint256 _createProposalFee
    ) external initializer {
        if (_reinsertPot == address(0) || _createProposalFee == 0) {
            revert InvalidArgument();
        }

        reinsertPot = _reinsertPot;
        createProposalFee = _createProposalFee;
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external payable {
        address proposer = msg.sender;

        uint256 proposalId = hashProposal(
            targets,
            values,
            calldatas,
            keccak256(bytes(description))
        );

        if (proposalExists(proposalId)) {
            revert ProposalAlreadyExist(proposalId);
        }

        if (msg.value != createProposalFee) {
            revert InsufficientFunds();
        }

        proposals[proposalId] = Proposal({
            proposer: proposer,
            state: ProposalState.Created,
            targets: targets,
            values: values,
            calldatas: calldatas,
            description: description
        });

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

    function cancel(uint256 proposalId) external exists(proposalId) {}

    function vote(uint256 proposalId) external exists(proposalId) {}

    function voteWithReason(
        uint256 proposalId,
        string calldata reason
    ) external exists(proposalId) {}

    function finalize(uint256 proposalId) external exists(proposalId) {}

    function execute(uint256 proposalId) external exists(proposalId) {
        if (!proposalExists(proposalId)) {
            revert ProposalNotExist(proposalId);
        }

        Proposal storage proposal = proposals[proposalId];

        if (proposal.state != ProposalState.Accepted) {
            revert ProposalCannotBeExecuted(proposalId, proposal.state);
        }

        proposal.state = ProposalState.Executed;

        _executeOperations(
            proposal.targets,
            proposal.values,
            proposal.calldatas
        );
    }

    function proposalExists(uint256 proposalId) public view returns (bool) {
        return proposals[proposalId].proposer != address(0);
    }

    function getProposal(
        uint256 proposalId
    ) public view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function countVotes(uint256 proposalId) public {}

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

    function _vote(uint256 proposalId, string calldata reason) internal {}

    function _executeOperations(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) internal {
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

    function _transferNative(address recipient, uint256 amount) internal {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert TransferFailed(address(this), recipient, amount);
        }
    }

    /// this list would go on forever,
    /// bUt all usual ballots like TransferErc20, TransferERC721
    /// are already solved in implementations of (gnosis) global safe.
    /// here we could use multisend.
}
