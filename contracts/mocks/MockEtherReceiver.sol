// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.8.25;

contract MockEtherReceiver {
    bool public allowReceive;

    error ReceiveDisabled();

    constructor() {
        allowReceive = true;
    }

    receive() external payable {
        if (!allowReceive) {
            revert ReceiveDisabled();
        }
    }

    function toggleReceive(bool allow) external {
        allowReceive = allow;
    }
}
