import { auth } from "@/lib/auth";
import { runInsightsQuery } from "@/lib/cloudwatch";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

const cleanModel = (key: string) =>
  key
    .replace(/^arn:aws:bedrock:[^:]+:\d+:inference-profile\//, "")
    .replace(/^us\./, "")
    .replace(/^anthropic\./, "")
    .replace(/^amazon\./, "")
    .replace(/^meta\./, "");

type ModelStats = { totalIn: number; totalOut: number; cacheRead: number; cacheWrite: number; invocations: number };

type KeyEntry = {
  mtdIn: number; mtdOut: number; mtdInv: number;
  recentIn: number; recentOut: number; recentInv: number;
  mtdCacheRead: number; mtdCacheWrite: number;
  recentCacheRead: number; recentCacheWrite: number;
  lastUsed: string | null;
  models: Record<string, ModelStats>;
};

function emptyEntry(): KeyEntry {
  return {
    mtdIn: 0, mtdOut: 0, mtdInv: 0,
    recentIn: 0, recentOut: 0, recentInv: 0,
    mtdCacheRead: 0, mtdCacheWrite: 0,
    recentCacheRead: 0, recentCacheWrite: 0,
    lastUsed: null,
    models: {},
  };
}

const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const region = req.nextUrl.searchParams.get("region") ?? "us-east-1";
  const activeKeysParam = req.nextUrl.searchParams.get("activeKeys");
  let activeKeys: Record<string, string> = {};
  if (activeKeysParam) {
    try { activeKeys = JSON.parse(activeKeysParam); } catch { /* ignore malformed */ }
  }

  const cacheKey = `${region}:${activeKeysParam ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  const cwl = new CloudWatchLogsClient({ region });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const fieldsClause = `fields input.inputTokenCount as inTok, output.outputTokenCount as outTok,
       coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok,
       coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok,
       modelId, identity.arn as userArn`;

  const statsClause = `stats sum(inTok) as totalIn, sum(outTok) as totalOut,
        sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite,
        count(*) as inv by identity.arn, modelId`;

  try {
    const [mtdResults, recentResults, lastUsedResults] = await Promise.all([
      runInsightsQuery(
        cwl,
        `${fieldsClause}\n| ${statsClause}\n| sort totalIn desc`,
        monthStart,
        now
      ),
      runInsightsQuery(
        cwl,
        `${fieldsClause}\n| ${statsClause}\n| sort totalIn desc`,
        ninetyDaysAgo,
        now
      ),
      runInsightsQuery(
        cwl,
        `fields @timestamp, identity.arn as userArn
         | stats max(@timestamp) as lastUsed by identity.arn`,
        ninetyDaysAgo,
        now
      ),
    ]);

    const extractKey = (arn: string) => {
      const m = arn.match(/user\/bedrock-key-(.+)$/);
      return m ? m[1] : arn.replace(/.*user\//, "");
    };

    const allKeys: Record<string, KeyEntry> = {};

    for (const r of mtdResults) {
      const k = extractKey(r["identity.arn"] ?? "");
      if (!allKeys[k]) allKeys[k] = emptyEntry();
      const entry = allKeys[k];
      const totalIn = parseInt(r.totalIn ?? "0");
      const totalOut = parseInt(r.totalOut ?? "0");
      const cacheRead = parseInt(r.cacheRead ?? "0");
      const cacheWrite = parseInt(r.cacheWrite ?? "0");
      const inv = parseInt(r.inv ?? "0");

      entry.mtdIn += totalIn;
      entry.mtdOut += totalOut;
      entry.mtdInv += inv;
      entry.mtdCacheRead += cacheRead;
      entry.mtdCacheWrite += cacheWrite;

      // Accumulate per-model data
      const model = cleanModel(r.modelId ?? "unknown");
      if (!entry.models[model]) entry.models[model] = { totalIn: 0, totalOut: 0, cacheRead: 0, cacheWrite: 0, invocations: 0 };
      entry.models[model].totalIn += totalIn;
      entry.models[model].totalOut += totalOut;
      entry.models[model].cacheRead += cacheRead;
      entry.models[model].cacheWrite += cacheWrite;
      entry.models[model].invocations += inv;
    }

    for (const r of recentResults) {
      const k = extractKey(r["identity.arn"] ?? "");
      if (!allKeys[k]) allKeys[k] = emptyEntry();
      const entry = allKeys[k];
      entry.recentIn += parseInt(r.totalIn ?? "0");
      entry.recentOut += parseInt(r.totalOut ?? "0");
      entry.recentInv += parseInt(r.inv ?? "0");
      entry.recentCacheRead += parseInt(r.cacheRead ?? "0");
      entry.recentCacheWrite += parseInt(r.cacheWrite ?? "0");

      // Merge model data from recent window (models map accumulates from MTD above,
      // but for keys created after month start, recent data may differ)
      const model = cleanModel(r.modelId ?? "unknown");
      if (!entry.models[model]) {
        entry.models[model] = {
          totalIn: parseInt(r.totalIn ?? "0"),
          totalOut: parseInt(r.totalOut ?? "0"),
          cacheRead: parseInt(r.cacheRead ?? "0"),
          cacheWrite: parseInt(r.cacheWrite ?? "0"),
          invocations: parseInt(r.inv ?? "0"),
        };
      }
    }

    for (const r of lastUsedResults) {
      const k = extractKey(r["identity.arn"] ?? "");
      if (!allKeys[k]) allKeys[k] = emptyEntry();
      allKeys[k].lastUsed = r.lastUsed ?? null;
    }

    if (Object.keys(activeKeys).length === 0) {
      cache.set(cacheKey, { data: allKeys, expiry: Date.now() + CACHE_TTL });
      return NextResponse.json(allKeys);
    }

    // Scoped re-queries for keys created within the 90-day window
    const keysNeedingRequery: { name: string; createdAt: Date; arn: string }[] = [];
    for (const [name, createdAtStr] of Object.entries(activeKeys)) {
      const createdAt = new Date(createdAtStr);
      if (createdAt > ninetyDaysAgo) {
        keysNeedingRequery.push({
          name,
          createdAt,
          arn: `bedrock-key-${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        });
      }
    }

    if (keysNeedingRequery.length > 0) {
      const scopedQueries = keysNeedingRequery.flatMap((k) => [
        runInsightsQuery(
          cwl,
          `${fieldsClause}\n| filter identity.arn like /${k.arn}/\n| ${statsClause}`,
          k.createdAt,
          now
        ),
        k.createdAt > monthStart
          ? runInsightsQuery(
              cwl,
              `${fieldsClause}\n| filter identity.arn like /${k.arn}/\n| ${statsClause}`,
              k.createdAt,
              now
            )
          : Promise.resolve([]),
      ]);

      const scopedResults = await Promise.all(scopedQueries);

      for (let i = 0; i < keysNeedingRequery.length; i++) {
        const k = keysNeedingRequery[i];
        const lifetimeResult = scopedResults[i * 2];
        const mtdResult = scopedResults[i * 2 + 1];

        if (lifetimeResult.length > 0) {
          if (allKeys[k.name]) {
            // Reset and re-accumulate from scoped results
            allKeys[k.name].recentIn = 0;
            allKeys[k.name].recentOut = 0;
            allKeys[k.name].recentInv = 0;
            allKeys[k.name].recentCacheRead = 0;
            allKeys[k.name].recentCacheWrite = 0;
            allKeys[k.name].models = {};
            for (const r of lifetimeResult) {
              allKeys[k.name].recentIn += parseInt(r.totalIn ?? "0");
              allKeys[k.name].recentOut += parseInt(r.totalOut ?? "0");
              allKeys[k.name].recentInv += parseInt(r.inv ?? "0");
              allKeys[k.name].recentCacheRead += parseInt(r.cacheRead ?? "0");
              allKeys[k.name].recentCacheWrite += parseInt(r.cacheWrite ?? "0");

              const model = cleanModel(r.modelId ?? "unknown");
              if (!allKeys[k.name].models[model]) {
                allKeys[k.name].models[model] = { totalIn: 0, totalOut: 0, cacheRead: 0, cacheWrite: 0, invocations: 0 };
              }
              allKeys[k.name].models[model].totalIn += parseInt(r.totalIn ?? "0");
              allKeys[k.name].models[model].totalOut += parseInt(r.totalOut ?? "0");
              allKeys[k.name].models[model].cacheRead += parseInt(r.cacheRead ?? "0");
              allKeys[k.name].models[model].cacheWrite += parseInt(r.cacheWrite ?? "0");
              allKeys[k.name].models[model].invocations += parseInt(r.inv ?? "0");
            }
          }
        } else if (allKeys[k.name]) {
          allKeys[k.name].recentIn = 0;
          allKeys[k.name].recentOut = 0;
          allKeys[k.name].recentInv = 0;
          allKeys[k.name].recentCacheRead = 0;
          allKeys[k.name].recentCacheWrite = 0;
        }

        if (mtdResult.length > 0 && allKeys[k.name]) {
          allKeys[k.name].mtdIn = 0;
          allKeys[k.name].mtdOut = 0;
          allKeys[k.name].mtdInv = 0;
          allKeys[k.name].mtdCacheRead = 0;
          allKeys[k.name].mtdCacheWrite = 0;
          for (const r of mtdResult) {
            allKeys[k.name].mtdIn += parseInt(r.totalIn ?? "0");
            allKeys[k.name].mtdOut += parseInt(r.totalOut ?? "0");
            allKeys[k.name].mtdInv += parseInt(r.inv ?? "0");
            allKeys[k.name].mtdCacheRead += parseInt(r.cacheRead ?? "0");
            allKeys[k.name].mtdCacheWrite += parseInt(r.cacheWrite ?? "0");
          }
        } else if (k.createdAt > monthStart && allKeys[k.name]) {
          allKeys[k.name].mtdIn = 0;
          allKeys[k.name].mtdOut = 0;
          allKeys[k.name].mtdInv = 0;
          allKeys[k.name].mtdCacheRead = 0;
          allKeys[k.name].mtdCacheWrite = 0;
        }
      }
    }

    // Calculate unattributed usage
    const activeKeyNames = new Set(Object.keys(activeKeys));
    const unattrib = emptyEntry();

    for (const [name, stats] of Object.entries(allKeys)) {
      if (!activeKeyNames.has(name)) {
        unattrib.mtdIn += stats.mtdIn;
        unattrib.mtdOut += stats.mtdOut;
        unattrib.mtdInv += stats.mtdInv;
        unattrib.mtdCacheRead += stats.mtdCacheRead;
        unattrib.mtdCacheWrite += stats.mtdCacheWrite;
        unattrib.recentIn += stats.recentIn;
        unattrib.recentOut += stats.recentOut;
        unattrib.recentInv += stats.recentInv;
        unattrib.recentCacheRead += stats.recentCacheRead;
        unattrib.recentCacheWrite += stats.recentCacheWrite;
        // Merge models
        for (const [model, m] of Object.entries(stats.models)) {
          if (!unattrib.models[model]) unattrib.models[model] = { totalIn: 0, totalOut: 0, cacheRead: 0, cacheWrite: 0, invocations: 0 };
          unattrib.models[model].totalIn += m.totalIn;
          unattrib.models[model].totalOut += m.totalOut;
          unattrib.models[model].cacheRead += m.cacheRead;
          unattrib.models[model].cacheWrite += m.cacheWrite;
          unattrib.models[model].invocations += m.invocations;
        }
      }
    }

    const result: Record<string, KeyEntry> = {};
    for (const name of activeKeyNames) {
      if (allKeys[name]) result[name] = allKeys[name];
    }

    if (unattrib.mtdInv > 0 || unattrib.recentInv > 0) {
      result["__unattributed__"] = unattrib;
    }

    cache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({});
  }
}
