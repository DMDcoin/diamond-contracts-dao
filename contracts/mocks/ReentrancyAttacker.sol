// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.17;

import { IDiamondDao } from "../interfaces/IDiamondDao.sol";

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
