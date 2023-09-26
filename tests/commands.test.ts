import { describe, expect, test } from "@jest/globals";
import { Probot, Server, run } from "probot";
import { EmitterWebhookEventName } from "@octokit/webhooks";
import { bindEvents } from "../src/bindings";
import { GithubEvent, Issue } from "../src/types";
import { Octokit } from "octokit";
import "dotenv/config";
import {
  waitForNWebhooks,
  updateConfig,
  webhookEventEmitter,
  createLabel,
  addLabelToIssue,
  removeLabelFromIssue,
  createComment,
  checkLastComment,
  getLastComment,
} from "./utils";
import { RepositoryConfig } from "../src/types";
import { repoConfig } from "./test-repo-config";

const TEST_TIME_LABEL = "Time: <1 Hour";
const TEST_PRIORITY_LABEL = "Priority: 1 (Normal)";

const SIX_HOURS = 6 * 60 * 60 * 1000; // 6 hours
const DATE_NOW = new Date().toISOString();
let server: Server;
let octokitAdmin: Octokit;
let octokitCollaborator: Octokit;

const owner = process.env.TEST_ORGANIZATION_NAME || "ubiquibot";
const repo = process.env.TEST_REPOSITORY_NAME || "staging";

let adminUsername = "";
let collaboratorUsername = "";

const orgConfig: RepositoryConfig = {
  privateKeyEncrypted:
    "YU-tFJFczN3JPVoJu0pQKSbWoeiCFPjKiTXMoFnJxDDxUNX-BBXc6ZHkcQcHVjdOd6ZcEnU1o2jU3F-i05mGJPmhF2rhQYXkNlxu5U5fZMMcgxJ9INhAmktzRBUxWncg4L1HOalZIoQ7gm3nk1a84g",
};

const CustomOctokit = Octokit.defaults({
  throttle: {
    onRateLimit: () => {
      return true;
    },
    onSecondaryRateLimit: () => {
      return true;
    },
  },
});

beforeAll(async () => {
  const adminPAT = process.env.TEST_ADMIN_PAT;
  if (!adminPAT) {
    throw new Error("missing TEST_ADMIN_PAT");
  }

  octokitAdmin = new CustomOctokit({ auth: adminPAT });

  const { data } = await octokitAdmin.rest.users.getAuthenticated();
  adminUsername = data.login;

  // check if the user is admin
  const { data: data1 } = await octokitAdmin.rest.repos.getCollaboratorPermissionLevel({
    repo,
    owner,
    username: adminUsername,
  });
  if (data1.permission !== "admin") {
    throw new Error("TEST_ADMIN_PAT is not admin");
  }

  const outsideCollaboratorPAT = process.env.TEST_OUTSIDE_COLLABORATOR_PAT;
  if (!outsideCollaboratorPAT) {
    throw new Error("missing TEST_OUTSIDE_COLLABORATOR_PAT");
  }

  octokitCollaborator = new CustomOctokit({ auth: outsideCollaboratorPAT });

  const { data: data2 } = await octokitCollaborator.rest.users.getAuthenticated();
  collaboratorUsername = data2.login;

  // check if the user is outside collaborator
  const { data: data3 } = await octokitAdmin.rest.repos.getCollaboratorPermissionLevel({
    repo,
    owner,
    username: collaboratorUsername,
  });
  if (data3.permission === "admin" || data3.permission === "write") {
    throw new Error("TEST_OUTSIDE_COLLABORATOR_PAT is not outside collaborator");
  }
  if (data3.permission !== "read") {
    throw new Error("TEST_OUTSIDE_COLLABORATOR_PAT does not have read access");
  }

  server = await run(function main(app: Probot) {
    const allowedEvents = Object.values(GithubEvent) as EmitterWebhookEventName[];
    app.on(allowedEvents, async (context) => {
      await bindEvents(context);
      webhookEventEmitter.emit("event", context.payload);
    });
  });

  await updateConfig(octokitAdmin, owner, "ubiquibot-config", ".github/ubiquibot-config.yml", orgConfig);
  await waitForNWebhooks(1);
  await updateConfig(octokitAdmin, owner, repo, ".github/ubiquibot-config.yml", repoConfig);
  await waitForNWebhooks(1);
}, SIX_HOURS);

afterAll(async () => {
  await server?.stop();
}, SIX_HOURS);

describe("commands test", () => {
  let issue: Issue;

  beforeAll(async () => {
    const res = await octokitAdmin.rest.issues.create({
      repo,
      owner,
      title: `${DATE_NOW} - E2E TEST`,
    });
    issue = res.data as Issue;

    await waitForNWebhooks(4);
  }, SIX_HOURS);

  test(
    "/wallet correct address",
    async () => {
      const newWallet = "0x82AcFE58e0a6bE7100874831aBC56Ee13e2149e7";
      await createComment(octokitAdmin, owner, repo, issue.number, `/wallet ${newWallet}`);
      await waitForNWebhooks(2);
      await checkLastComment(
        octokitAdmin,
        owner,
        repo,
        issue.number,
        `Updated the wallet address for @${adminUsername} successfully!\t Your new address: \`${newWallet}\``
      );
    },
    SIX_HOURS
  );

  test(
    "/wallet wrong address",
    async () => {
      const newWallet = "0x82AcFE58e0a6bE7100874831aBC56";
      await createComment(octokitAdmin, owner, repo, issue.number, `/wallet ${newWallet}`);
      await waitForNWebhooks(2);
      await checkLastComment(
        octokitAdmin,
        owner,
        repo,
        issue.number,
        `Please include your wallet or ENS address.\n usage: /wallet 0x0000000000000000000000000000000000000000`
      );
    },
    SIX_HOURS
  );

  test(
    "/multiplier",
    async () => {
      await createComment(octokitAdmin, owner, repo, issue.number, `/multiplier @${adminUsername}`);
      await waitForNWebhooks(2);

      await checkLastComment(
        octokitAdmin,
        owner,
        repo,
        issue.number,
        `Successfully changed the payout multiplier for @${adminUsername} to 1. The reason is not provided.`
      );

      await createComment(octokitAdmin, owner, repo, issue.number, `/multiplier @${adminUsername} 2`);
      await waitForNWebhooks(2);

      await checkLastComment(
        octokitAdmin,
        owner,
        repo,
        issue.number,
        `Successfully changed the payout multiplier for @${adminUsername} to 2. The reason is not provided. This feature is designed to limit the contributor's compensation for any task on the current repository due to other compensation structures (i.e. salary.) are you sure you want to use a price multiplier above 1?`
      );

      await createComment(octokitAdmin, owner, repo, issue.number, `/multiplier @${adminUsername} 2 "Testing reason"`);
      await waitForNWebhooks(2);

      await checkLastComment(
        octokitAdmin,
        owner,
        repo,
        issue.number,
        `Successfully changed the payout multiplier for @${adminUsername} to 2. The reason provided is "Testing reason". This feature is designed to limit the contributor's compensation for any task on the current repository due to other compensation structures (i.e. salary.) are you sure you want to use a price multiplier above 1?`
      );

      await createComment(octokitAdmin, owner, repo, issue.number, `/multiplier @${adminUsername} abcd`);
      await waitForNWebhooks(2);

      await checkLastComment(
        octokitAdmin,
        owner,
        repo,
        issue.number,
        `Successfully changed the payout multiplier for @${adminUsername} to 1. The reason provided is "abcd".`
      );

      await createComment(octokitAdmin, owner, repo, issue.number, `/multiplier abcd`);
      await waitForNWebhooks(2);

      await checkLastComment(
        octokitAdmin,
        owner,
        repo,
        issue.number,
        `Successfully changed the payout multiplier for @${adminUsername} to 1. The reason provided is "abcd".`
      );
    },
    SIX_HOURS
  );

  test(
    "/query",
    async () => {
      const newWallet = "0x82AcFE58e0a6bE7100874831aBC56Ee13e2149e7";
      await createComment(octokitAdmin, owner, repo, issue.number, `/wallet ${newWallet}`);
      await waitForNWebhooks(2);

      const multiplier = "5";
      await createComment(octokitAdmin, owner, repo, issue.number, `/multiplier @${adminUsername} ${multiplier} 'Testing'`);
      await waitForNWebhooks(2);

      await createComment(octokitAdmin, owner, repo, issue.number, `/query @${adminUsername}`);
      await waitForNWebhooks(2);

      const lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain(`@${adminUsername}'s wallet address is ${newWallet}, multiplier is ${multiplier}`);
    },
    SIX_HOURS
  );

  test(
    "/query wrong username",
    async () => {
      await createComment(octokitAdmin, owner, repo, issue.number, `/query @INVALID_$USERNAME`);
      await waitForNWebhooks(2);

      await checkLastComment(octokitAdmin, owner, repo, issue.number, `Invalid syntax for query command \n usage /query @user`);
    },
    SIX_HOURS
  );

  test(
    "/help",
    async () => {
      await createComment(octokitAdmin, owner, repo, issue.number, `/help`);
      await waitForNWebhooks(2);

      const lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body?.includes("Available Commands")).toBe(true);
    },
    SIX_HOURS
  );

  test(
    "/allow",
    async () => {
      await createLabel(octokitAdmin, owner, repo, TEST_PRIORITY_LABEL);

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        labels: [],
      });

      await createComment(octokitAdmin, owner, repo, issue.number, `/allow set-priority @${collaboratorUsername} false`);
      await waitForNWebhooks(2);

      let lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain(`Updated access for @${collaboratorUsername} successfully!\t Access: **priority** for "${owner}/${repo}"`);

      // collaborator adds label
      await addLabelToIssue(octokitCollaborator, owner, repo, issue.number, TEST_PRIORITY_LABEL);
      await waitForNWebhooks(3);

      let issueDetails = await octokitAdmin.rest.issues.get({
        owner,
        repo,
        issue_number: issue.number,
      });
      expect(issueDetails.data.labels?.length).toBe(0);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain(`@${collaboratorUsername}, You are not allowed to add Priority: 1 (Normal)`);

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        labels: [TEST_PRIORITY_LABEL],
      });

      await removeLabelFromIssue(octokitCollaborator, owner, repo, issue.number, TEST_PRIORITY_LABEL);
      await waitForNWebhooks(3);

      issueDetails = await octokitAdmin.rest.issues.get({
        owner,
        repo,
        issue_number: issue.number,
      });
      expect(issueDetails.data.labels?.length).toBe(1);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain(`@${collaboratorUsername}, You are not allowed to remove Priority: 1 (Normal)`);

      await createComment(octokitAdmin, owner, repo, issue.number, `/allow set-priority @${collaboratorUsername} true`);
      await waitForNWebhooks(2);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain(`Updated access for @${collaboratorUsername} successfully!\t Access: **priority** for "${owner}/${repo}"`);

      await removeLabelFromIssue(octokitCollaborator, owner, repo, issue.number, TEST_PRIORITY_LABEL);
      await waitForNWebhooks(1);

      issueDetails = await octokitAdmin.rest.issues.get({
        owner,
        repo,
        issue_number: issue.number,
      });
      expect(issueDetails.data.labels?.length).toBe(0);

      await addLabelToIssue(octokitCollaborator, owner, repo, issue.number, TEST_PRIORITY_LABEL);
      await waitForNWebhooks(1);

      issueDetails = await octokitAdmin.rest.issues.get({
        owner,
        repo,
        issue_number: issue.number,
      });
      expect(issueDetails.data.labels?.length).toBe(1);
    },
    SIX_HOURS
  );

  test(
    "/start and /stop",
    async () => {
      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        labels: [],
      });

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "closed",
      });
      await waitForNWebhooks(2);

      let lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain("Permit generation disabled because this issue didn't qualify for funding");

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "open",
      });
      await waitForNWebhooks(1);

      try {
        await octokitAdmin.rest.issues.createLabel({
          owner,
          repo,
          name: TEST_TIME_LABEL,
        });
      } catch (err) {
        expect(err).toBeDefined();
      } finally {
        await octokitAdmin.rest.issues.addLabels({
          owner,
          repo,
          issue_number: issue.number,
          labels: [TEST_TIME_LABEL],
        });
        await waitForNWebhooks(1);
      }

      try {
        await octokitAdmin.rest.issues.createLabel({
          owner,
          repo,
          name: TEST_PRIORITY_LABEL,
        });
      } catch (err) {
        expect(err).toBeDefined();
      } finally {
        await octokitAdmin.rest.issues.addLabels({
          owner,
          repo,
          issue_number: issue.number,
          labels: [TEST_PRIORITY_LABEL],
        });
        await waitForNWebhooks(2);
      }

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "closed",
      });
      await waitForNWebhooks(2);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain("Permit generation disabled because assignee is undefined");

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "open",
      });
      await waitForNWebhooks(1);

      await createComment(octokitAdmin, owner, repo, issue.number, `/autopay false`);
      await waitForNWebhooks(2);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain("Automatic payment for this issue is enabled: **false**");

      await createComment(octokitAdmin, owner, repo, issue.number, `/start`);
      await waitForNWebhooks(3);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      const lastCommentBody = lastComment.body?.toLowerCase();
      expect(lastCommentBody).toContain("deadline");
      expect(lastCommentBody).toContain("registered wallet");
      expect(lastCommentBody).toContain("payment multiplier");
      expect(lastCommentBody).toContain("multiplier reason");

      await createComment(octokitAdmin, owner, repo, issue.number, `/stop`);
      await waitForNWebhooks(3);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toBe(`You have been unassigned from the task @${adminUsername}`);

      await createComment(octokitAdmin, owner, repo, issue.number, `/start`);
      await waitForNWebhooks(3);

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "closed",
      });
      await waitForNWebhooks(2);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain("Permit generation disabled because automatic payment for this issue is disabled.");

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "open",
      });
      await waitForNWebhooks(1);

      await createComment(octokitAdmin, owner, repo, issue.number, `/autopay true`);
      await waitForNWebhooks(2);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toBe("Automatic payment for this issue is enabled: **true**");

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "closed",
        state_reason: "not_planned",
      });
      await waitForNWebhooks(2);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain("Permit generation disabled because this is marked as unplanned");

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "open",
      });
      await waitForNWebhooks(1);

      await octokitAdmin.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: "closed",
      });
      await waitForNWebhooks(2);

      lastComment = await getLastComment(octokitAdmin, owner, repo, issue.number);
      expect(lastComment.body).toContain("Task Assignee Reward");
    },
    SIX_HOURS
  );
});