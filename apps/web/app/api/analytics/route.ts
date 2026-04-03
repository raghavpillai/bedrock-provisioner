import { auth } from "@/lib/auth";
import { runInsightsQuery } from "@/lib/cloudwatch";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import {
  IAMClient,
  ListUsersCommand,
  ListUserTagsCommand,
} from "@aws-sdk/client-iam";

const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const region = searchParams.get("region") ?? "us-east-1";
  const groupBy = searchParams.get("groupBy") ?? "model"; // model | apiKey | user
  const year = parseInt(searchParams.get("year") ?? new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") ?? (new Date().getMonth() + 1).toString());
  const granularity = searchParams.get("granularity") ?? "day"; // day | hour
  const day = searchParams.get("day"); // YYYY-MM-DD for hourly drill-down

  // Sanitize filter inputs — only allow alphanumeric, hyphens, underscores, dots, @
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_\-\.@]/g, "");
  const filterApiKey = sanitize(searchParams.get("apiKey") ?? "");
  const filterModel = sanitize(searchParams.get("model") ?? "");
  const filterUser = sanitize(searchParams.get("user") ?? "");

  const startTime = new Date(year, month - 1, 1);
  const endTime = new Date(year, month, 0, 23, 59, 59);

  // Build filter clause
  const filters: string[] = [];
  if (filterApiKey) filters.push(`identity.arn like /${filterApiKey}/`);
  if (filterModel) filters.push(`modelId like /${filterModel}/`);
  if (filterUser) filters.push(`identity.arn like /${filterUser}/`);
  const filterClause = filters.length > 0 ? `| filter ${filters.join(" and ")}\n` : "";

  // Hourly drill-down: scope to a single day with 1h bins
  let binSize = "bin(1d)";
  let queryStart = startTime;
  let queryEnd = endTime;
  if (granularity === "hour" && day) {
    const dayDate = new Date(day + "T00:00:00Z");
    queryStart = dayDate;
    queryEnd = new Date(dayDate.getTime() + 24 * 60 * 60 * 1000 - 1);
    binSize = "bin(1h)";
  }

  const cacheKey = `${region}:${groupBy}:${year}:${month}:${granularity}:${day}:${filterApiKey}:${filterModel}:${filterUser}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  const cwl = new CloudWatchLogsClient({ region });

  try {
    const dailyQuery = `
      fields input.inputTokenCount as inTok, output.outputTokenCount as outTok,
             coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok,
             coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok,
             modelId, identity.arn as userArn
      ${filterClause}| stats sum(inTok) as totalIn, sum(outTok) as totalOut,
              sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite,
              count(*) as invocations
        by ${binSize} as day, modelId, identity.arn
      | sort day asc
    `;

    const summaryQuery = `
      fields input.inputTokenCount as inTok, output.outputTokenCount as outTok,
             coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok,
             coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok,
             modelId, identity.arn as userArn
      ${filterClause}| stats sum(inTok) as totalIn, sum(outTok) as totalOut,
              sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite,
              count(*) as invocations
        by modelId, identity.arn
      | sort totalIn desc
    `;

    const [daily, summary] = await Promise.all([
      runInsightsQuery(cwl, dailyQuery, queryStart, queryEnd).catch(() => []),
      runInsightsQuery(cwl, summaryQuery, queryStart, queryEnd).catch(() => []),
    ]);

    // Resolve IAM usernames to emails for user groupBy
    let userEmailMap = new Map<string, string>();
    if (groupBy === "user") {
      try {
        const iam = new IAMClient({ region });
        const usersRes = await iam.send(new ListUsersCommand({ PathPrefix: "/" }));
        const bedrockUsers = (usersRes.Users ?? []).filter((u) =>
          u.UserName?.startsWith("bedrock-key-")
        );
        await Promise.all(
          bedrockUsers.map(async (u) => {
            try {
              const tags = await iam.send(new ListUserTagsCommand({ UserName: u.UserName! }));
              const createdBy = tags.Tags?.find((t) => t.Key === "rockbed:createdBy")?.Value;
              if (createdBy && createdBy !== "unknown") {
                userEmailMap.set(u.UserName!, createdBy);
              }
            } catch {}
          })
        );
      } catch {}
    }

    const cleanUser = (arn: string) => {
      const match = arn.match(/user\/(.+)$/);
      if (match) {
        const userName = match[1];
        if (groupBy === "user") {
          return userEmailMap.get(userName) ?? userName.replace(/^bedrock-key-/, "");
        }
        return userName.replace(/^bedrock-key-/, "");
      }
      if (arn.includes(":root")) return "root";
      return arn;
    };

    const cleanModel = (key: string) =>
      key
        .replace(/^arn:aws:bedrock:[^:]+:\d+:inference-profile\//, "")
        .replace(/^us\./, "")
        .replace(/^anthropic\./, "")
        .replace(/^amazon\./, "")
        .replace(/^meta\./, "");

    const mapRow = (r: Record<string, string>) => ({
      userKey: cleanUser(r["identity.arn"] ?? r.userArn ?? "unknown"),
      modelKey: cleanModel(r.modelId ?? "unknown"),
      totalIn: parseInt(r.totalIn ?? "0"),
      totalOut: parseInt(r.totalOut ?? "0"),
      cacheRead: parseInt(r.cacheRead ?? "0"),
      cacheWrite: parseInt(r.cacheWrite ?? "0"),
      invocations: parseInt(r.invocations ?? "0"),
    });

    const result = {
      daily: daily
        .filter((r) => (r.modelId || r.userArn || r["identity.arn"]) && r.totalIn)
        .map((r) => ({ day: r.day, ...mapRow(r) })),
      summary: summary
        .filter((r) => (r.modelId || r.userArn || r["identity.arn"]) && r.totalIn)
        .map(mapRow),
      period: { year, month, startTime: queryStart.toISOString(), endTime: queryEnd.toISOString() },
    };
    cache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[analytics]", err);
    return NextResponse.json({
      daily: [],
      summary: [],
      period: { year, month, startTime: queryStart.toISOString(), endTime: queryEnd.toISOString() },
      error: "Failed to load analytics data",
    });
  }
}
