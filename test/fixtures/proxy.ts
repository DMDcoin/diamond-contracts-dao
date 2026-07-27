import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import type { NetworkConnection } from "hardhat/types/network";

type ViemHelpers = NetworkConnection["viem"];

export const ERC1967AdminSlot =
    "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;

export const ERC1967ImplementationSlot =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

export function addressFromStorageSlot(slotValue: string): Address {
    return getAddress(`0x${slotValue.slice(-40)}`);
}

export interface DeployProxiedOptions {
    initArgs?: readonly unknown[];
    initializer?: string | null;
    implementationArgs?: readonly unknown[];
    adminOwner?: Address;
}

export async function deployProxy<Name extends string>(
    viem: ViemHelpers,
    contractName: Name,
    options: DeployProxiedOptions = {},
) {
    const [defaultWallet] = await viem.getWalletClients();

    const adminOwner = options.adminOwner ?? defaultWallet.account.address;

    const implementation = await viem.deployContract(contractName, (options.implementationArgs ?? []) as never);

    const initData: Hex =
        options.initializer === null
            ? "0x"
            : encodeFunctionData({
                  abi: implementation.abi,
                  functionName: options.initializer ?? "initialize",
                  args: options.initArgs ?? [],
              });

    const proxy = await viem.deployContract("TransparentUpgradeableProxy", [
        implementation.address,
        adminOwner,
        initData,
    ]);

    const contract = await viem.getContractAt(contractName, proxy.address);

    return contract;
}
