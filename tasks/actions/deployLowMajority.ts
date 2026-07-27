import type { NewTaskActionFunction } from "hardhat/types/tasks";

import { deployProxy } from "../../test/fixtures/proxy.js";
import { KnownContractNames, requireKnownContract } from "../knownContracts.js";
import { getProxyAdminAddress, getProxyImplementationAddress } from "../helpers.js";

const deployLowMajorityContract: NewTaskActionFunction = async (_taskArguments, hre) => {
  const { viem } = await hre.network.connect();
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();

  const daoAddress = requireKnownContract(KnownContractNames.DiamondDao);

  console.log("using address for deployment:", deployer.account.address);

  const newContract = await deployProxy(viem, KnownContractNames.DiamondDaoLowMajority, {
    initArgs: [daoAddress],
    initializer: "initialize",
    adminOwner: deployer.account.address,
  });

  const proxyAddress = newContract.address;
  console.log("Proxy address: ", proxyAddress);

  const implementationAddress = await getProxyImplementationAddress(publicClient, proxyAddress);
  console.log("Implementation:", implementationAddress);

  const adminAddress = await getProxyAdminAddress(publicClient, proxyAddress);
  console.log("Proxy Admin:", adminAddress);

  console.log("transfering ownership to DAO.");
  const proxyAdmin = await viem.getContractAt("ProxyAdmin", adminAddress);
  await proxyAdmin.write.transferOwnership([daoAddress], { account: deployer.account });
};

export default deployLowMajorityContract;
