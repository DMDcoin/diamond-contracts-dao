
import { getInitializerData } from "@openzeppelin/hardhat-upgrades/dist/utils";
import hre from "hardhat";
import { ethers } from "hardhat";
import fs from "fs";

const daoImplementationAddress = "0xDA00000000000000000000000000000000000000";
const daoProxyAddress = "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0";

// low majority = decaffeinated DAO :)
const daoLowMajorityImplementationAddress = "0xdA000000000000000000000000000000000dECAF";
const daoLowMajorityProxyAddress = "0xDA0DA0DA0da0dA0Da0DA00da0DA0DA00000DeCaF";

interface ContractSpec {
    balance: string,
    constructor: string
}

async function compileProxy() {
    const proxyFactory = await hre.ethers.getContractFactory("TransparentUpgradeableProxy");

    //await proxyFactory
    //const contractFactory = await hre.ethers.getContractFactory(this.name!);
    const daoFactory = await hre.ethers.getContractFactory("DiamondDao");
    const lowMajorityDaoFactory = await hre.ethers.getContractFactory("DiamondDaoLowMajority");

    let spec: { [id: string]: ContractSpec; } = {};

    spec[daoImplementationAddress] = {
        balance: "0",
        constructor: (await daoFactory.getDeployTransaction()).data
    };

    spec[daoLowMajorityImplementationAddress] = {
        balance: "0",
        constructor: (await lowMajorityDaoFactory.getDeployTransaction()).data
    }

    // DiamondDAO Proxy:

    let startTimeStamp = new Date(Date.now()).getTime() / 1000;
    let startTimeBigInt = BigInt(Math.floor(startTimeStamp));

    let daoInitArgs: any[] = [
        daoProxyAddress, //address _contractOwner,
        "0x1000000000000000000000000000000000000001", //address _validatorSet,
        "0x1100000000000000000000000000000000000001", //address _stakingHbbft,
        "0x2000000000000000000000000000000000000001", //address _reinsertPot,
        "0x4000000000000000000000000000000000000001", //address _txPermission,
        daoLowMajorityProxyAddress, //address _lowMajorityDao
        ethers.parseEther("10"),//uint256 _createProposalFee,
        startTimeBigInt //uint64 _startTimestamp
    ];

    console.log("DAO Initializer Arguments: ", daoInitArgs);
    const initializerData = getInitializerData(daoFactory.interface, daoInitArgs, 'initialize');

    //let proxyArgs = [];
    let proxyDeployTX = await proxyFactory.getDeployTransaction(daoImplementationAddress, daoProxyAddress, initializerData);

    const lowMajorityDaoInitArgs: any[] = [daoProxyAddress];
    const lowMajorityDaoInitializerCalldata = getInitializerData(
        lowMajorityDaoFactory.interface,
        lowMajorityDaoInitArgs,
        'initialize',
    );
    const lowMajorotyDaoProxyDeployTX = await proxyFactory.getDeployTransaction(
        daoLowMajorityImplementationAddress, // implementation address
        daoProxyAddress, // proxy initial owner
        lowMajorityDaoInitializerCalldata, // initializer calldata
    );

    console.log("Low majority DAO Initializer Arguments: ", lowMajorityDaoInitArgs);

    spec[daoProxyAddress] = {
        balance: "0",
        constructor: proxyDeployTX.data
    };

    spec[daoLowMajorityProxyAddress] = {
        balance: "0",
        constructor: lowMajorotyDaoProxyDeployTX.data
    };

    if (!fs.existsSync("out")) {
        fs.mkdirSync("out");
    }

    fs.writeFileSync("out/spec_dao.json", JSON.stringify(spec));

    //spec[]

    //let data = proxyDeployTX.data;
    //const initializerData = getInitializerData(contractFactory.interface, args, 'initialize')
    //const tx = await proxyFactory.getDeployTransaction(logicAddress, ownerAddress, initializerData);

    //this.proxyBytecode = tx.data;
}

compileProxy();