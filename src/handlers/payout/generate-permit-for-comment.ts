import { getLogger } from "../../bindings";
import { parseComments } from "../../helpers";
import { Incentives, User } from "../../types";
import { getWalletAddress } from "../comment";
import Decimal from "decimal.js";
import { ItemsToExclude } from "./post";
import { calculateRewardValue } from "./calculate-reward-value";

export async function generatePermitForComment(
  user: User,
  comments: string[],
  multiplier: number,
  incentives: Incentives,
  permitMaxPrice: number
): Promise<undefined | { account: string; amountInBigNumber: Decimal }> {
  const logger = getLogger();
  const commentsByNode = parseComments(comments, ItemsToExclude);
  const rewardValue = calculateRewardValue(commentsByNode, incentives);
  if (rewardValue.equals(0)) {
    logger.info(
      `No reward for the user: ${user.login}. comments: ${JSON.stringify(commentsByNode)}, sum: ${rewardValue}`
    );
    return;
  }
  logger.debug(
    `Comment parsed for the user: ${user.login}. comments: ${JSON.stringify(commentsByNode)}, sum: ${rewardValue}`
  );
  const account = await getWalletAddress(user.id);
  const amountInBigNumber = rewardValue.mul(multiplier);
  if (amountInBigNumber.gt(permitMaxPrice)) {
    logger.info(
      `Skipping issue creator reward for user ${user.login} because reward is higher than payment permit max price`
    );
    return;
  }
  if (account) {
    return { account, amountInBigNumber };
  } else {
    return { account: "0x", amountInBigNumber: new Decimal(0) };
  }
}