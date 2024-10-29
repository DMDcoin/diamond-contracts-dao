import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { attachProxyAdminV5, } from "@openzeppelin/hardhat-upgrades/dist/utils";

const daoAddress = "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0";

async function getUpgradeCalldata() {
    const proxyAdmin = await attachProxyAdminV5(
        hre,
        await upgrades.erc1967.getAdminAddress(daoAddress)
    );
    
    console.log("Proxy Admin: ", proxyAdmin.target)
    const factory = await ethers.getContractFactory("DiamondDao");
    const newImplementation = await upgrades.deployImplementation(factory);

    console.log("New imp. address: ", newImplementation)
    const calldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
        daoAddress,
        newImplementation,
        ethers.hexlify(new Uint8Array()),
    ]);
    console.log("Calldata: ", calldata);

    console.log("Verifying implementation contract...");
    await hre.run("verify:verify", {
        address: newImplementation,
        constructorArguments: [],
    });
    return console.log("Implementation contract verified!");
}

getUpgradeCalldata().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
