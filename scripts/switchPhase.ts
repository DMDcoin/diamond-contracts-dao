import { ethers } from "hardhat";
import { DiamondDao } from "../typechain-types";



async function forwardPhase() {


    
    const [signer] = await ethers.getSigners();

    const contractFactory = await ethers.getContractFactory("DiamondDao", signer);
  
    let daoContract =contractFactory.attach("0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0") as DiamondDao;
    

    while (true) {
      let respone = await daoContract.switchPhase();
      console.log("switching Phase with Transaction:", respone.hash);
      await respone.wait(1, 1_800_000);

      // daoContract.
    }
  }
  
  forwardPhase();