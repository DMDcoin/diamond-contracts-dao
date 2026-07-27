import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";

export const daoTasks = [
  task("vote-yes", "Votes yes to all available proposals")
    .setAction(async () => await import("./actions/voteYes.js"))
    .build(),

  task("deployLowMajorityContract", "deploys LowMajority contract")
    .setAction(async () => await import("./actions/deployLowMajority.js"))
    .build(),

  task("getUpgradeCalldata", "Get contract upgrade calldata to use in DAO proposal")
    .addOption({
      name: "contract",
      description: "The core contract name to upgrade",
      type: ArgumentType.STRING,
      defaultValue: "DiamondDao",
    })
    .addOption({
      name: "output",
      description: "Output file name",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "impl",
      description: "Address of new core contract implementation",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "initFunc",
      description: "Initialization or reinitialization function",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addVariadicArgument({
      name: "initArgs",
      description: "Initialization function arguments",
      defaultValue: [],
    })
    .setAction(async () => await import("./actions/getUpgradeCalldata.js"))
    .build(),
];
