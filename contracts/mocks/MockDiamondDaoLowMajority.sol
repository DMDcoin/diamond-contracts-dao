// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

import { DiamondDaoLowMajority } from "../DiamondDaoLowMajority.sol";

contract MockDiamondDaoLowMajority is DiamondDaoLowMajority {
    function setMainDaoAddress(address _mainDao) external {
        mainDao = _mainDao;
    }
}
