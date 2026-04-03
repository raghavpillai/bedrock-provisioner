import { auth } from "@/lib/auth";
import { runInsightsQuery } from "@/lib/cloudwatch";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const region = req.nextUrl.searchParams.get("region") ?? "us-east-1";
  // activeKeys: JSON map of { "key-name": "2026-01-15T00:00:00.000Z", ... }
  const activeKeysParam = req.nextUrl.searchParams.get("activeKeys");
  let activeKeys: Record<string, string> = {};
  if (activeKeysParam) {
    try { activeKeys = JSON.parse(activeKeysParam); } catch { /* ignore malformed */ }
  }

  const cwl = new CloudWatchLogsClient({ region });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  try {
    // Run all-time queries for the full windows (includes deleted key usage)
    const [mtdResults, recentResults, lastUsedResults] = await Promise.all([
      runInsightsQuery(
        cwl,
        `fields input.inputTokenCount as inTok, output.outputTokenCount as outTok, identity.arn as userArn
         | stats sum(inTok) as totalIn, sum(outTok) as totalOut, count(*) as inv by identity.arn
         | sort totalIn desc`,
        monthStart,
        now
      ),
      runInsightsQuery(
        cwl,
        `fields input.inputTokenCount as inTok, output.outputTokenCount as outTok, identity.arn as userArn
         | stats sum(inTok) as totalIn, sum(outTok) as totalOut, count(*) as inv by identity.arn
         | sort totalIn desc`,
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

    // Build full (unfiltered) stats for all keys ever seen
    const allKeys: Record<string, {
      mtdIn: number; mtdOut: number; mtdInv: number;
      recentIn: number; recentOut: number; recentInv: number;
      lastUsed: string | null;
    }> = {};

    for (const r of mtdResults) {
      const k = extractKey(r["identity.arn"] ?? "");
      if (!allKeys[k]) allKeys[k] = { mtdIn: 0, mtdOut: 0, mtdInv: 0, recentIn: 0, recentOut: 0, recentInv: 0, lastUsed: null };
      allKeys[k].mtdIn = parseInt(r.totalIn ?? "0");
      allKeys[k].mtdOut = parseInt(r.totalOut ?? "0");
      allKeys[k].mtdInv = parseInt(r.inv ?? "0");
    }

    for (const r of recentResults) {
      const k = extractKey(r["identity.arn"] ?? "");
      if (!allKeys[k]) allKeys[k] = { mtdIn: 0, mtdOut: 0, mtdInv: 0, recentIn: 0, recentOut: 0, recentInv: 0, lastUsed: null };
      allKeys[k].recentIn = parseInt(r.totalIn ?? "0");
      allKeys[k].recentOut = parseInt(r.totalOut ?? "0");
      allKeys[k].recentInv = parseInt(r.inv ?? "0");
    }

    for (const r of lastUsedResults) {
      const k = extractKey(r["identity.arn"] ?? "");
      if (!allKeys[k]) allKeys[k] = { mtdIn: 0, mtdOut: 0, mtdInv: 0, recentIn: 0, recentOut: 0, recentInv: 0, lastUsed: null };
      allKeys[k].lastUsed = r.lastUsed ?? null;
    }

    // If no active keys provided, return as-is (backwards compatible)
    if (Object.keys(activeKeys).length === 0) {
      return NextResponse.json(allKeys);
    }

    // For active keys whose createdAt is after the 90-day window start,
    // re-query scoped to their creation date to get accurate lifetime stats.
    // Collect keys that need scoped queries.
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

    // Run scoped queries for keys that were recreated within the window
    if (keysNeedingRequery.length > 0) {
      const scopedQueries = keysNeedingRequery.flatMap((k) => [
        // Scoped lifetime query
        runInsightsQuery(
          cwl,
          `fields input.inputTokenCount as inTok, output.outputTokenCount as outTok, identity.arn as userArn
           | filter identity.arn like /${k.arn}/
           | stats sum(inTok) as totalIn, sum(outTok) as totalOut, count(*) as inv by identity.arn`,
          k.createdAt,
          now
        ),
        // Scoped MTD query (only if created before this month, otherwise MTD is already correct)
        k.createdAt > monthStart
          ? runInsightsQuery(
              cwl,
              `fields input.inputTokenCount as inTok, output.outputTokenCount as outTok, identity.arn as userArn
               | filter identity.arn like /${k.arn}/
               | stats sum(inTok) as totalIn, sum(outTok) as totalOut, count(*) as inv by identity.arn`,
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
          const r = lifetimeResult[0];
          if (allKeys[k.name]) {
            allKeys[k.name].recentIn = parseInt(r.totalIn ?? "0");
            allKeys[k.name].recentOut = parseInt(r.totalOut ?? "0");
            allKeys[k.name].recentInv = parseInt(r.inv ?? "0");
          }
        } else if (allKeys[k.name]) {
          // No usage since creation
          allKeys[k.name].recentIn = 0;
          allKeys[k.name].recentOut = 0;
          allKeys[k.name].recentInv = 0;
        }

        if (mtdResult.length > 0) {
          const r = mtdResult[0];
          if (allKeys[k.name]) {
            allKeys[k.name].mtdIn = parseInt(r.totalIn ?? "0");
            allKeys[k.name].mtdOut = parseInt(r.totalOut ?? "0");
            allKeys[k.name].mtdInv = parseInt(r.inv ?? "0");
          }
        } else if (k.createdAt > monthStart && allKeys[k.name]) {
          allKeys[k.name].mtdIn = 0;
          allKeys[k.name].mtdOut = 0;
          allKeys[k.name].mtdInv = 0;
        }
      }
    }

    // Calculate unattributed usage: total across all keys minus active keys
    const activeKeyNames = new Set(Object.keys(activeKeys));
    let unattribMtdIn = 0, unattribMtdOut = 0, unattribMtdInv = 0;
    let unattribRecentIn = 0, unattribRecentOut = 0, unattribRecentInv = 0;

    for (const [name, stats] of Object.entries(allKeys)) {
      if (!activeKeyNames.has(name)) {
        unattribMtdIn += stats.mtdIn;
        unattribMtdOut += stats.mtdOut;
        unattribMtdInv += stats.mtdInv;
        unattribRecentIn += stats.recentIn;
        unattribRecentOut += stats.recentOut;
        unattribRecentInv += stats.recentInv;
      }
    }

    // Only include active keys + unattributed in response
    const result: Record<string, typeof allKeys[string]> = {};
    for (const name of activeKeyNames) {
      if (allKeys[name]) result[name] = allKeys[name];
    }

    if (unattribMtdInv > 0 || unattribRecentInv > 0) {
      result["__unattributed__"] = {
        mtdIn: unattribMtdIn, mtdOut: unattribMtdOut, mtdInv: unattribMtdInv,
        recentIn: unattribRecentIn, recentOut: unattribRecentOut, recentInv: unattribRecentInv,
        lastUsed: null,
      };
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({});
  }
}
