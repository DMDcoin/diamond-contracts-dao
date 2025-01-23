
import { getInitializerData } from "@openzeppelin/hardhat-upgrades/dist/utils";
import hre from "hardhat";
import { ethers } from "hardhat";
import fs from "fs";

const daoImplementationAddress = "0xDA00000000000000000000000000000000000000";
const daoProxyAddress = "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0";

interface ContractSpec {
    balance: string,
    constructor: string
}

async function compileProxy() {
    const proxyFactory = await hre.ethers.getContractFactory("TransparentUpgradeableProxy");
    
    //await proxyFactory
    //const contractFactory = await hre.ethers.getContractFactory(this.name!);
    const daoFactory = await hre.ethers.getContractFactory("DiamondDao");

    let spec:  { [id: string] : ContractSpec; }  = {};

    spec[daoImplementationAddress] =  {
        balance: "0",
        constructor: (await daoFactory.getDeployTransaction()).data
    };

    // Proxy:

    let startTimeStamp = new Date(Date.now()).getTime() / 1000;
    let startTimeBigInt = BigInt(Math.floor(startTimeStamp));
    
    let daoInitArgs: any[] = [
        daoProxyAddress, //address _contractOwner,
        "0x1000000000000000000000000000000000000001", //address _validatorSet,
        "0x1100000000000000000000000000000000000001", //address _stakingHbbft,
        "0x2000000000000000000000000000000000000001", //address _reinsertPot,
        "0x4000000000000000000000000000000000000001", //address _txPermission,
        ethers.parseEther("10"),//uint256 _createProposalFee,
        startTimeBigInt //uint64 _startTimestamp
    ];

    console.log("Initializer Arguments:", daoInitArgs);
    const initializerData = getInitializerData(daoFactory.interface, daoInitArgs, 'initialize');

    //let proxyArgs = [];
    let proxyDeployTX = await proxyFactory.getDeployTransaction(daoImplementationAddress, daoProxyAddress, initializerData);
    spec[daoProxyAddress] = {
        balance: "0",
        constructor: proxyDeployTX.data
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