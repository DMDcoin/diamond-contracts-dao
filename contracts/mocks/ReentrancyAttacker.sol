// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { IDiamondDao } from "../interfaces/IDiamondDao.sol";
import { IDiamondDaoLowMajority } from "../interfaces/IDiamondDaoLowMajority.sol";

contract ReentrancyAttacker {
    IDiamondDao public dao;
    uint256 public proposalId;
    uint256 public calls;

    constructor(address _dao) {
        dao = IDiamondDao(_dao);
        calls = 0;
    }

    receive() external payable {
        if (calls != 5) {
            dao.execute(proposalId);
            ++calls;
        }
    }

    function setId(uint256 _proposalId) external {
        proposalId = _proposalId;
    }

    function attack() external {
        dao.execute(proposalId);
    }

    function getBalance() external view returns (uint) {
        return address(this).balance;
    }
}

contract ReentrancyAttackerLowMajority {
    uint256 public calls;

    constructor() {
        calls = 0;
    }

    receive() external payable {
        IDiamondDaoLowMajority dao = IDiamondDaoLowMajority(msg.sender);

        address[] memory _targets = new address[](1);
        _targets[0] = address(this);

        uint256[] memory _values = new uint256[](1);
        _values[0] = 10 ether;

        bytes[] memory _calldata = new bytes[](1);
        _calldata[0] = bytes("");

        if (calls != 5) {
            dao.execute(1, _targets, _values, _calldata);
        
            ++calls;
        }
    }

    function getBalance() external view returns (uint) {
        return address(this).balance;
    }
}
