



#!/bin/sh

# todo: figure out what contracts did have changed.

output_file="2025_12_21_contracts.txt"
NETWORK="--network mainnet"

#npx hardhat $NETWORK analyze
#npx hardhat $NETWORK deployLowMajorityContract
npx hardhat --network mainnet getUpgradeCalldata --output "$output_file" --contract DiamondDao
 
