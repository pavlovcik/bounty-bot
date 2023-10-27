import Runtime from "../../bindings/bot-runtime";
import { createCommitComment, getFileContent } from "../../helpers";
import { CommitsPayload, PushPayload, ConfigSchema } from "../../types";
import { parseYamlConfig } from "../../utils/get-config";
import { validate } from "../../utils/ajv";

export const ZERO_SHA = "0000000000000000000000000000000000000000";
export const BASE_RATE_FILE = ".github/ubiquibot-config.yml";

export function getCommitChanges(commits: CommitsPayload[]) {
  const changes = [] as string[];

  for (const commit of commits) {
    for (const modifiedFile of commit.modified) {
      changes.push(modifiedFile);
    }
    for (const addedFile of commit.added) {
      changes.push(addedFile);
    }
  }
  return changes;
}

export async function validateConfigChange() {
  const runtime = Runtime.getState();
  const logger = runtime.logger;

  const context = runtime.latestEventContext;
  const payload = context.payload as PushPayload;

  if (!payload.ref.startsWith("refs/heads/")) {
    logger.debug("Skipping push events, not a branch");
    return;
  }

  const changes = getCommitChanges(payload.commits);

  // skip if empty
  if (changes && changes.length === 0) {
    logger.debug("Skipping push events, file change empty 3");
    return;
  }

  // check for modified or added files and check for specified file
  if (changes.includes(BASE_RATE_FILE)) {
    const commitSha = payload.commits
      .filter((commit) => commit.modified.includes(BASE_RATE_FILE) || commit.added.includes(BASE_RATE_FILE))
      .reverse()[0]?.id;
    if (!commitSha) {
      logger.debug("Skipping push events, commit sha not found");
      return;
    }

    const configFileContent = await getFileContent(
      payload.repository.owner.login,
      payload.repository.name,
      payload.ref.split("refs/heads/")[1],
      BASE_RATE_FILE,
      commitSha
    );

    if (configFileContent) {
      const decodedConfig = Buffer.from(configFileContent, "base64").toString();
      const config = parseYamlConfig(decodedConfig);
      const { valid, error } = validate(ConfigSchema, config);
      if (!valid) {
        await createCommitComment(
          `@${payload.sender.login} Config validation failed! ${error}`,
          commitSha,
          BASE_RATE_FILE
        );
        logger.info("Config validation failed!", error);
      }
    }
  }
  logger.debug("Skipping push events, file change empty 4");
}
