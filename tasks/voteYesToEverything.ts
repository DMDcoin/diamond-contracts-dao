
import { task } from 'hardhat/config';
import { DiamondDao } from '../typechain-types';

const KnownContractNames = {
    DiamondDao: "DiamondDao",
    DiamondDaoLowMajority: "DiamondDaoLowMajority"
}

const KnownContracts = new Map<string, string>([
    [KnownContractNames.DiamondDao, "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0"],
    [KnownContractNames.DiamondDaoLowMajority, "0x"]
]);

task("vote-yes", "Votes yes to all available proposals")
    .setAction(async (taskArgs, hre) => {
        
        const proxyAddress = KnownContracts.get("DiamondDao")!;
        
        const contractFactory = await hre.ethers.getContractFactory("DiamondDao");

        const dao = contractFactory.attach(proxyAddress) as DiamondDao;
        const stakingAddress = await dao.stakingHbbft();

        console.log(`Stacking address: ${stakingAddress}`);

        const stakingContract = await hre.ethers.getContractAt("IStakingHbbft", stakingAddress);        
        const allSigners = await hre.ethers.getSigners();

        let voters = [];
        for (const signer of allSigners) {
            if (await stakingContract.isPoolValid(signer.address)) {
                voters.push(signer);
            }
        }
        
        if (voters.length === 0) { 
            console.log("No voters found among signers. Exiting.");
            return;
        }

        const proposals = await dao.getCurrentPhaseProposals();

        if (proposals.length === 0) { 
            console.log("No proposals found in the current phase. Exiting.");
            return;
        }

        console.log("voters:", voters.length);

        for (const proposal of proposals) {
            console.log(`Voting YES on proposal ${proposal}`);

            let waitTxs = [];
            for(const signer of voters) {
                console.log(`Signer ${signer.address} is voting YES on proposal ${proposal}`);
                const daoWithSigner = dao.connect(signer);

                try {
                    const tx = await daoWithSigner.vote(proposal, 1);
                    waitTxs.push(tx);
                } catch(e) {
                    console.log("Failed to vote: ", e);
                }
                
            }

            console.log("awaiting transactions.");

            for (const wait of waitTxs) {
                await wait.wait();
            }
        }
    });