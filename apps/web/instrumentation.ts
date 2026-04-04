import {
  IAMClient,
  ListUsersCommand,
  ListUserTagsCommand,
  ListServiceSpecificCredentialsCommand,
  UpdateServiceSpecificCredentialCommand,
  TagUserCommand,
} from "@aws-sdk/client-iam";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { runInsightsQuery } from "@/lib/cloudwatch";
import { calculateCost, USER_PREFIX, BEDROCK_SERVICE_NAME } from "@rockbed/shared";

const ENFORCE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const REGIONS = ["us-east-1"];

const cleanModel = (key: string) =>
  key
    .replace(/^arn:aws:bedrock:[^:]+:\d+:inference-profile\//, "")
    .replace(/^us\./, "")
    .replace(/^anthropic\./, "")
    .replace(/^amazon\./, "")
    .replace(/^meta\./, "");

async function enforceDailyLimits() {
  for (const region of REGIONS) {
    try {
      const iam = new IAMClient({ region });
      const cwl = new CloudWatchLogsClient({ region });

      const usersRes = await iam.send(new ListUsersCommand({ PathPrefix: "/" }));
      const bedrockUsers = (usersRes.Users ?? []).filter((u) =>
        u.UserName?.startsWith(USER_PREFIX)
      );

      for (const user of bedrockUsers) {
        try {
          const tagsRes = await iam.send(new ListUserTagsCommand({ UserName: user.UserName! }));
          const tags = tagsRes.Tags ?? [];
          const limitStr = tags.find((t) => t.Key === "rockbed:dailySpendLimit")?.Value;

          const autoDisabledAt = tags.find((t) => t.Key === "rockbed:autoDisabledAt")?.Value;

          // Re-enable keys that were auto-disabled on a previous day
          if (autoDisabledAt && autoDisabledAt !== "") {
            const disabledDate = new Date(autoDisabledAt);
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (disabledDate < today) {
              const credsRes = await iam.send(
                new ListServiceSpecificCredentialsCommand({
                  UserName: user.UserName!,
                  ServiceName: BEDROCK_SERVICE_NAME,
                })
              );
              for (const cred of credsRes.ServiceSpecificCredentials ?? []) {
                if (cred.Status === "Inactive") {
                  await iam.send(
                    new UpdateServiceSpecificCredentialCommand({
                      UserName: user.UserName!,
                      ServiceSpecificCredentialId: cred.ServiceSpecificCredentialId!,
                      Status: "Active",
                    })
                  );
                }
              }
              await iam.send(
                new TagUserCommand({
                  UserName: user.UserName!,
                  Tags: [{ Key: "rockbed:autoDisabledAt", Value: "" }],
                })
              );
              console.log(`[spend-limit] Re-enabled ${user.UserName} — new day`);
            }
          }

          if (!limitStr || limitStr === "none" || limitStr === "") continue;

          const limit = parseFloat(limitStr);
          if (isNaN(limit) || limit <= 0) continue;

          const now = new Date();
          const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const arnPattern = user.UserName!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

          const results = await runInsightsQuery(
            cwl,
            `fields input.inputTokenCount as inTok, output.outputTokenCount as outTok,
                   coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok,
                   coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok,
                   modelId
             | filter identity.arn like /${arnPattern}/
             | stats sum(inTok) as totalIn, sum(outTok) as totalOut,
                     sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite
               by modelId`,
            dayStart,
            now
          );

          let todaySpend = 0;
          for (const r of results) {
            const model = cleanModel(r.modelId ?? "unknown");
            todaySpend += calculateCost(
              model,
              parseInt(r.totalIn ?? "0"),
              parseInt(r.totalOut ?? "0"),
              parseInt(r.cacheRead ?? "0"),
              parseInt(r.cacheWrite ?? "0"),
            );
          }

          if (todaySpend >= limit) {
            const credsRes = await iam.send(
              new ListServiceSpecificCredentialsCommand({
                UserName: user.UserName!,
                ServiceName: BEDROCK_SERVICE_NAME,
              })
            );

            for (const cred of credsRes.ServiceSpecificCredentials ?? []) {
              if (cred.Status === "Active") {
                await iam.send(
                  new UpdateServiceSpecificCredentialCommand({
                    UserName: user.UserName!,
                    ServiceSpecificCredentialId: cred.ServiceSpecificCredentialId!,
                    Status: "Inactive",
                  })
                );
                console.log(
                  `[spend-limit] Disabled ${user.UserName} — $${todaySpend.toFixed(2)} >= $${limit} limit`
                );
              }
            }

            await iam.send(
              new TagUserCommand({
                UserName: user.UserName!,
                Tags: [{ Key: "rockbed:autoDisabledAt", Value: now.toISOString() }],
              })
            );
          }
        } catch (err) {
          console.error(`[spend-limit] Error checking ${user.UserName}:`, err);
        }
      }
    } catch (err) {
      console.error(`[spend-limit] Error in region ${region}:`, err);
    }
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || typeof globalThis !== "undefined") {
    console.log("[spend-limit] Starting enforcement cron (every 5 min)");
    setInterval(() => {
      enforceDailyLimits().catch((err) =>
        console.error("[spend-limit] Cron error:", err)
      );
    }, ENFORCE_INTERVAL);

    // Run once on startup after a short delay
    setTimeout(() => {
      enforceDailyLimits().catch((err) =>
        console.error("[spend-limit] Initial run error:", err)
      );
    }, 10_000);
  }
}
