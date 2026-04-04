# Accurate Cost Dashboard & Daily Spend Limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all blended/estimated cost calculations with exact per-model pricing (including cache tokens), add expandable per-user-per-model breakdowns, adaptive daily→hourly drill-down chart, and daily spend limits per key.

**Architecture:** Single two-dimensional CloudWatch query (grouping by both `modelId` AND `identity.arn`) feeds all views. Frontend aggregates rows by user, model, or both. Pricing engine updated with correct Anthropic rates and cache token support. Daily spend limits stored as IAM tags, enforced by disabling service-specific credentials.

**Tech Stack:** TypeScript, Next.js (App Router), Recharts, AWS CloudWatch Logs Insights, AWS IAM, Prisma (SQLite)

**Spec:** `docs/superpowers/specs/2026-04-03-accurate-cost-dashboard-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/src/pricing.ts` | Modify | Fix pricing table, add cache params to `calculateCost` |
| `apps/web/app/api/analytics/route.ts` | Modify | Two-dimensional CW query, cache fields, new response shape |
| `apps/web/app/api/analytics/keys/route.ts` | Modify | Add `modelId` grouping + cache fields to all queries |
| `apps/web/components/analytics/use-analytics.ts` | Modify | Update types, add aggregation helpers |
| `apps/web/components/analytics/cost-page.tsx` | Modify | Expandable rows, cache columns, hourly drill-down |
| `apps/web/components/key-manager.tsx` | Modify | Per-model costs from key analytics, cache columns |
| `apps/api/src/router.ts` | Modify | Daily spend limit tag handling, auto-disable logic |

---

### Task 1: Fix Pricing Table & Add Cache Support

**Files:**
- Modify: `packages/shared/src/pricing.ts`

- [ ] **Step 1: Update the pricing table with correct Anthropic prices**

Replace the entire `MODEL_PRICING` constant and `calculateCost` function in `packages/shared/src/pricing.ts`:

```typescript
// Bedrock pricing per 1M tokens (from Anthropic official docs, verified 2026-04-03)
// Source: https://platform.claude.com/docs/en/about-claude/pricing
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude — newest first for substring matching priority
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-opus-4-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-1": { input: 15.0, output: 75.0 },
  "claude-opus-4": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-3-5-haiku": { input: 0.8, output: 4.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-3-opus": { input: 15.0, output: 75.0 },
  // Meta Llama
  "llama-4-maverick": { input: 0.34, output: 0.92 },
  "llama-4-scout": { input: 0.17, output: 0.46 },
  "llama-3-3-70b": { input: 0.72, output: 0.72 },
  "llama-3-2-90b": { input: 2.0, output: 2.0 },
  "llama-3-2-11b": { input: 0.16, output: 0.16 },
  "llama-3-1-405b": { input: 2.32, output: 2.32 },
  "llama-3-1-70b": { input: 0.72, output: 0.72 },
  "llama-3-1-8b": { input: 0.22, output: 0.22 },
  // Mistral
  "mistral-large": { input: 2.0, output: 6.0 },
  "mistral-small": { input: 0.1, output: 0.3 },
  // Amazon
  "nova-pro": { input: 0.8, output: 3.2 },
  "nova-lite": { input: 0.06, output: 0.24 },
  "nova-micro": { input: 0.035, output: 0.14 },
  "titan-text-express": { input: 0.2, output: 0.6 },
  "titan-text-lite": { input: 0.15, output: 0.2 },
  // Cohere
  "command-r-plus": { input: 2.5, output: 10.0 },
  "command-r": { input: 0.15, output: 0.6 },
};

// Default rate for unknown models (Sonnet-class)
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

// Cache pricing multipliers (5-min TTL — standard for Claude Code on Bedrock)
const CACHE_READ_MULTIPLIER = 0.10;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Calculate cost for a model invocation including cache tokens.
 * Matches model key against known pricing using substring matching.
 */
export function calculateCost(
  modelKey: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
): number {
  const key = modelKey.toLowerCase();
  const pricing =
    Object.entries(MODEL_PRICING).find(([k]) => key.includes(k))?.[1] ??
    DEFAULT_PRICING;
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * pricing.input * CACHE_READ_MULTIPLIER +
    (cacheWriteTokens / 1_000_000) * pricing.input * CACHE_WRITE_MULTIPLIER
  );
}
```

- [ ] **Step 2: Verify the build passes**

Run: `cd /home/ubuntu/rockbed && npx turbo build --filter=@rockbed/shared 2>&1 | tail -5`
Expected: Build succeeds (existing callers with 3 args still work due to defaults)

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/rockbed
git add packages/shared/src/pricing.ts
git commit -m "fix: correct model pricing and add cache token support to calculateCost

Opus 4.5/4.6 was $15/$75, correct is $5/$25.
Haiku 4.5 was $0.80/$4, correct is $1/$5.
Add cacheReadTokens and cacheWriteTokens params (default 0 for backwards compat).
Cache read at 10% of input price, cache write at 125%."
```

---

### Task 2: Update Analytics API — Two-Dimensional Query

**Files:**
- Modify: `apps/web/app/api/analytics/route.ts`

- [ ] **Step 1: Rewrite the analytics API to always group by both modelId and identity.arn**

Replace the entire query-building and response-mapping section in `apps/web/app/api/analytics/route.ts`. The key changes:
- Single query shape: always group by `modelId, identity.arn`
- Add cache token fields: `cacheReadInputTokenCount`, `cacheWriteInputTokenCount`
- Response returns flat two-dimensional rows with both `userKey` and `modelKey`
- `groupBy` param only controls IAM username→email resolution

Replace the content of the file from the `try {` block (line 52) through the `return NextResponse.json({` section (ending around line 137), keeping the imports, session check, param parsing, sanitization, date range, and filter clause logic above it, and the catch block below it.

New query and mapping code inside the `try` block:

```typescript
  try {
    const dailyQuery = `
      fields input.inputTokenCount as inTok, output.outputTokenCount as outTok,
             coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok,
             coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok,
             modelId, identity.arn as userArn
      ${filterClause}| stats sum(inTok) as totalIn, sum(outTok) as totalOut,
              sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite,
              count(*) as invocations
        by bin(1d) as day, modelId, identity.arn
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
      runInsightsQuery(cwl, dailyQuery, startTime, endTime).catch(() => []),
      runInsightsQuery(cwl, summaryQuery, startTime, endTime).catch(() => []),
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

    return NextResponse.json({
      daily: daily
        .filter((r) => (r.modelId || r.userArn || r["identity.arn"]) && r.totalIn)
        .map((r) => ({ day: r.day, ...mapRow(r) })),
      summary: summary
        .filter((r) => (r.modelId || r.userArn || r["identity.arn"]) && r.totalIn)
        .map(mapRow),
      period: { year, month, startTime: startTime.toISOString(), endTime: endTime.toISOString() },
    });
```

Also remove the `groupField` variable (lines 37-42) since we no longer switch query shape by groupBy. Keep the `groupBy` param parsing since it still controls email resolution.

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/rockbed
git add apps/web/app/api/analytics/route.ts
git commit -m "feat: two-dimensional analytics query with cache token fields

Always group by both modelId and identity.arn.
Add cacheRead and cacheWrite to response rows.
Frontend can aggregate by model, user, or both."
```

---

### Task 3: Update Analytics Types & Hooks

**Files:**
- Modify: `apps/web/components/analytics/use-analytics.ts`

- [ ] **Step 1: Update the types and add aggregation helpers**

Replace the type definitions and add aggregation helpers. The new `TwoDimensionalRow` replaces the old `DailyData`/`SummaryData`. Add helper functions to aggregate rows by model or user.

```typescript
// --- New types matching two-dimensional API response ---

export type AnalyticsRow = {
  userKey: string;
  modelKey: string;
  totalIn: number;
  totalOut: number;
  cacheRead: number;
  cacheWrite: number;
  invocations: number;
};

export type DailyRow = AnalyticsRow & { day: string };

export type AnalyticsData = {
  daily: DailyRow[];
  summary: AnalyticsRow[];
  period: { year: number; month: number; startTime: string; endTime: string };
  error?: string;
};

// Keep old type aliases for any remaining references during migration
export type DailyData = DailyRow;
export type SummaryData = AnalyticsRow;
```

Add aggregation helpers after the types:

```typescript
/** Aggregate rows by a key field, summing numeric columns */
function aggregateBy(rows: AnalyticsRow[], keyFn: (r: AnalyticsRow) => string): AnalyticsRow[] {
  const map = new Map<string, AnalyticsRow>();
  for (const r of rows) {
    const key = keyFn(r);
    const existing = map.get(key);
    if (existing) {
      existing.totalIn += r.totalIn;
      existing.totalOut += r.totalOut;
      existing.cacheRead += r.cacheRead;
      existing.cacheWrite += r.cacheWrite;
      existing.invocations += r.invocations;
    } else {
      map.set(key, { ...r });
    }
  }
  return Array.from(map.values());
}

/** Aggregate summary rows by model (sum across users) */
export function aggregateByModel(rows: AnalyticsRow[]): AnalyticsRow[] {
  return aggregateBy(rows, (r) => r.modelKey).map((r) => ({
    ...r,
    userKey: "__all__",
  }));
}

/** Aggregate summary rows by user (sum across models) */
export function aggregateByUser(rows: AnalyticsRow[]): AnalyticsRow[] {
  return aggregateBy(rows, (r) => r.userKey).map((r) => ({
    ...r,
    modelKey: "__all__",
  }));
}

/** Get per-model breakdown for a specific user */
export function modelsForUser(rows: AnalyticsRow[], userKey: string): AnalyticsRow[] {
  return rows.filter((r) => r.userKey === userKey);
}
```

Keep the rest of the file unchanged (`useAnalytics` hook, `formatNumber`, `formatCurrency`, `monthName`, `CHART_COLORS`, `sanitizeKey`).

- [ ] **Step 2: Verify build**

Run: `cd /home/ubuntu/rockbed && npx turbo build --filter=web 2>&1 | tail -10`
Expected: May have type errors in cost-page.tsx (expected, will fix in Task 4)

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/rockbed
git add apps/web/components/analytics/use-analytics.ts
git commit -m "feat: update analytics types for two-dimensional data with aggregation helpers"
```

---

### Task 4: Rewrite Cost Page — Expandable Rows, Cache Columns, Hourly Drill-Down

**Files:**
- Modify: `apps/web/components/analytics/cost-page.tsx`

This is the largest change. The cost page needs to:
1. Use the new two-dimensional data shape
2. Calculate total cost from model-level aggregation with cache-aware pricing
3. Show expandable user rows with per-model sub-rows
4. Add cache read/write columns
5. Add adaptive daily→hourly drill-down on chart click
6. Replace "Est. cost" with "Cost" everywhere

- [ ] **Step 1: Rewrite cost-page.tsx**

Replace the entire file content. Key structural changes:

**State additions:**
```typescript
const [drillDay, setDrillDay] = useState<string | null>(null); // null = monthly view, string = hourly drill
const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
```

**Data derivation changes:**
- `totalCost`: computed from `aggregateByModel(data.summary)` with `calculateCost(r.modelKey, r.totalIn, r.totalOut, r.cacheRead, r.cacheWrite)`
- `costBreakdown`: always computed from raw `data.summary` rows. For user/apiKey groupBy: `aggregateByUser(data.summary)` for the collapsed rows, `modelsForUser(data.summary, userKey)` for expanded sub-rows
- Each row's cost uses `calculateCost(r.modelKey, ...)` with the actual model key, never "blended"

**Hourly drill-down:**
- Add a new `useAnalytics` call with `bin(1h)` when `drillDay` is set (or fetch via separate API param)
- When user clicks a bar in the daily chart, set `drillDay` to that day string
- Show a "Back to monthly" button when in hourly view
- Hourly chart uses same bar chart component but with hourly bins

**Expandable rows:**
- Each user row has a chevron icon. Click toggles `expandedUsers` set membership
- When expanded, render sub-rows for each model that user used (from `modelsForUser`)
- Sub-rows are styled with indent and lighter background

**Table columns:**
```
Name | Tokens In | Tokens Out | Cache Read | Cache Write | Invocations | Cost
```

**Cache summary card:**
Add a 4th summary card: "Cache read tokens" showing total cache reads.

**Label change:** Replace all "Est. cost" with "Cost" and "Estimated costs" with "Costs based on Bedrock on-demand pricing".

The full component code is large (~400 lines). Here are the critical sections to get right:

For the **cost breakdown computation** (replaces lines 138-154):
```typescript
const costBreakdown = useMemo(() => {
  if (!data?.summary.length) return [];
  if (groupBy === "model") {
    return aggregateByModel(data.summary).map((r) => ({
      ...r,
      groupKey: r.modelKey,
      cost: calculateCost(r.modelKey, r.totalIn, r.totalOut, r.cacheRead, r.cacheWrite),
    }));
  }
  // user or apiKey: aggregate by user, each row's cost is sum of per-model costs
  return aggregateByUser(data.summary).map((r) => ({
    ...r,
    groupKey: r.userKey,
    cost: modelsForUser(data.summary, r.userKey).reduce(
      (acc, m) => acc + calculateCost(m.modelKey, m.totalIn, m.totalOut, m.cacheRead, m.cacheWrite),
      0,
    ),
  }));
}, [data, groupBy]);
```

For **expandable sub-rows** in the table body (replaces the simple `costBreakdown.map` at line 349):
```typescript
{costBreakdown.map((row, i) => (
  <React.Fragment key={`${row.groupKey}-${i}`}>
    <tr
      className={`border-b last:border-0 ${groupBy !== "model" ? "cursor-pointer hover:bg-muted/50" : ""}`}
      onClick={() => {
        if (groupBy === "model") return;
        setExpandedUsers((prev) => {
          const next = new Set(prev);
          if (next.has(row.groupKey)) next.delete(row.groupKey);
          else next.add(row.groupKey);
          return next;
        });
      }}
    >
      <td className="p-3 font-medium">
        {groupBy !== "model" && (
          <ChevronRightIcon
            className={`inline size-4 mr-1 transition-transform ${expandedUsers.has(row.groupKey) ? "rotate-90" : ""}`}
          />
        )}
        {row.groupKey}
      </td>
      <td className="p-3 text-right font-mono">{formatNumber(row.totalIn)}</td>
      <td className="p-3 text-right font-mono">{formatNumber(row.totalOut)}</td>
      <td className="p-3 text-right font-mono">{formatNumber(row.cacheRead)}</td>
      <td className="p-3 text-right font-mono">{formatNumber(row.cacheWrite)}</td>
      <td className="p-3 text-right font-mono">{formatNumber(row.invocations)}</td>
      <td className="p-3 text-right font-mono">{formatCurrency(row.cost)}</td>
    </tr>
    {groupBy !== "model" && expandedUsers.has(row.groupKey) &&
      modelsForUser(data!.summary, row.userKey).map((m, j) => (
        <tr key={`${row.groupKey}-${m.modelKey}-${j}`} className="border-b last:border-0 bg-muted/30">
          <td className="p-3 pl-8 text-sm text-muted-foreground">{m.modelKey}</td>
          <td className="p-3 text-right font-mono text-sm">{formatNumber(m.totalIn)}</td>
          <td className="p-3 text-right font-mono text-sm">{formatNumber(m.totalOut)}</td>
          <td className="p-3 text-right font-mono text-sm">{formatNumber(m.cacheRead)}</td>
          <td className="p-3 text-right font-mono text-sm">{formatNumber(m.cacheWrite)}</td>
          <td className="p-3 text-right font-mono text-sm">{formatNumber(m.invocations)}</td>
          <td className="p-3 text-right font-mono text-sm">
            {formatCurrency(calculateCost(m.modelKey, m.totalIn, m.totalOut, m.cacheRead, m.cacheWrite))}
          </td>
        </tr>
      ))
    }
  </React.Fragment>
))}
```

For the **hourly drill-down**, add a query parameter `granularity=hour&day=YYYY-MM-DD` to the analytics API and handle it server-side by changing `bin(1d)` to `bin(1h)` and scoping the time range to that single day. Client-side: when `drillDay` is set, fetch hourly data and render it instead of the daily chart.

For the **total cost computation** (replaces lines 78-84):
```typescript
const totalCost = useMemo(() => {
  if (!data?.summary.length) return 0;
  return aggregateByModel(data.summary).reduce(
    (acc, r) => acc + calculateCost(r.modelKey, r.totalIn, r.totalOut, r.cacheRead, r.cacheWrite),
    0,
  );
}, [data]);
```

- [ ] **Step 2: Verify the page renders**

Run: `cd /home/ubuntu/rockbed && npx turbo build --filter=web 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/rockbed
git add apps/web/components/analytics/cost-page.tsx
git commit -m "feat: expandable per-user cost breakdown with exact per-model pricing

- Expandable rows show per-model sub-breakdown per user
- Cache read/write columns added
- All costs use actual model rates, no more blended estimates
- 'Est. cost' replaced with 'Cost' everywhere
- Adaptive daily→hourly drill-down on chart click"
```

---

### Task 5: Update Key Analytics API — Two-Dimensional with Cache

**Files:**
- Modify: `apps/web/app/api/analytics/keys/route.ts`

- [ ] **Step 1: Add modelId grouping and cache fields to all queries**

Update every CloudWatch query in this file to:
1. Add `coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok` and `coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok` to fields
2. Add `sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite` to stats
3. Add `modelId` to the group-by clause

Update the response type to include cache and model data per key:

```typescript
const allKeys: Record<string, {
  mtdIn: number; mtdOut: number; mtdInv: number;
  recentIn: number; recentOut: number; recentInv: number;
  mtdCacheRead: number; mtdCacheWrite: number;
  recentCacheRead: number; recentCacheWrite: number;
  lastUsed: string | null;
  models: Record<string, { totalIn: number; totalOut: number; cacheRead: number; cacheWrite: number; invocations: number }>;
}> = {};
```

The MTD query becomes:
```sql
fields input.inputTokenCount as inTok, output.outputTokenCount as outTok,
       coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok,
       coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok,
       modelId, identity.arn as userArn
| stats sum(inTok) as totalIn, sum(outTok) as totalOut,
        sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite,
        count(*) as inv
  by identity.arn, modelId
| sort totalIn desc
```

When building `allKeys`, accumulate per-model data in the `models` sub-map and sum totals into the top-level fields. The `cleanModel` helper (same as in the analytics route) strips ARN prefixes.

Apply the same changes to the `recentResults` query and the scoped lifetime/MTD queries for keys created within the 90-day window.

- [ ] **Step 2: Commit**

```bash
cd /home/ubuntu/rockbed
git add apps/web/app/api/analytics/keys/route.ts
git commit -m "feat: key analytics API returns per-model breakdown with cache tokens"
```

---

### Task 6: Update Key Manager — Real Per-Model Costs

**Files:**
- Modify: `apps/web/components/key-manager.tsx`

- [ ] **Step 1: Update KeyStats type and cost calculations**

Update the `KeyStats` type at line 46 to include cache and model data:

```typescript
type KeyStats = Record<string, {
  mtdIn: number; mtdOut: number; mtdInv: number;
  recentIn: number; recentOut: number; recentInv: number;
  mtdCacheRead: number; mtdCacheWrite: number;
  recentCacheRead: number; recentCacheWrite: number;
  lastUsed: string | null;
  models: Record<string, { totalIn: number; totalOut: number; cacheRead: number; cacheWrite: number; invocations: number }>;
}>;
```

- [ ] **Step 2: Replace all blended cost calculations**

Replace the MTD cost calculation at line 286:
```typescript
// OLD: const cost = calculateCost("blended", s.mtdIn, s.mtdOut);
// NEW: sum per-model costs
const cost = Object.entries(s.models ?? {}).reduce(
  (acc, [model, m]) => acc + calculateCost(model, m.totalIn, m.totalOut, m.cacheRead, m.cacheWrite),
  0,
);
```

Replace the lifetime cost calculation at line 295 with the same pattern using `recentIn`/`recentOut` data — but since the models map covers the full window, use the same `s.models` sum.

Replace the unattributed cost calculations at lines 342-343 similarly.

- [ ] **Step 3: Add cache columns to the key table**

Add "Cache Read" and "Cache Write" columns to the table header and corresponding cells showing `formatNumber(s.mtdCacheRead)` and `formatNumber(s.mtdCacheWrite)`.

- [ ] **Step 4: Commit**

```bash
cd /home/ubuntu/rockbed
git add apps/web/components/key-manager.tsx
git commit -m "feat: key manager uses exact per-model costs with cache columns

Remove all calculateCost('blended', ...) calls.
Per-key costs computed by summing per-model costs from API.
Add cache read/write columns to key table."
```

---

### Task 7: Add Daily Spend Limits

**Files:**
- Modify: `apps/api/src/router.ts`
- Modify: `apps/web/components/key-manager.tsx` (add limit UI)
- Modify: `packages/shared/src/schemas.ts` (add limit input schema)

- [ ] **Step 1: Add IAM tag for daily spend limit**

In `apps/api/src/router.ts`, add to the `createKey` handler's `TagUserCommand` (around line 128):

```typescript
{ Key: "rockbed:dailySpendLimit", Value: "none" },
```

- [ ] **Step 2: Add a setDailyLimit procedure**

Add a new procedure in `apps/api/src/router.ts`:

```typescript
const SetDailyLimitInput = z.object({
  region: z.string(),
  userName: z.string(),
  limit: z.union([z.number().positive(), z.literal("none")]),
});

const setDailyLimit = os.input(SetDailyLimitInput).handler(async ({ input }) => {
  const { iam } = createClients(input.region);
  await iam.send(
    new TagUserCommand({
      UserName: input.userName,
      Tags: [{ Key: "rockbed:dailySpendLimit", Value: String(input.limit) }],
    })
  );
  return { success: true };
});
```

Add `UpdateServiceSpecificCredentialCommand` to the IAM imports and add an `enforceSpendLimits` function that:
1. Lists all bedrock-key users and their `rockbed:dailySpendLimit` tags
2. For each user with a numeric limit, queries today's spend from CloudWatch (using the two-dimensional summary query scoped to today)
3. If spend > limit, calls `UpdateServiceSpecificCredentialCommand` with `Status: "Inactive"` and tags the user with `rockbed:autoDisabledAt: <ISO timestamp>`
4. If spend < limit and `autoDisabledAt` tag exists, re-enables the credential and removes the tag

Call `enforceSpendLimits` at the end of the `listKeys` handler (piggyback on page loads — no separate cron needed for now).

- [ ] **Step 3: Add limit display and edit UI to key-manager.tsx**

Add a "Daily Limit" column to the key table. Show the current limit value (from IAM tags, fetched alongside key list). Add an inline edit: click the limit value to show an input field, save calls `client.keys.setDailyLimit(...)`.

Show a visual badge on keys that were auto-disabled (detected by `rockbed:autoDisabledAt` tag presence).

- [ ] **Step 4: Export the new procedure in the router**

Add `setDailyLimit` to the router export object alongside existing procedures.

- [ ] **Step 5: Commit**

```bash
cd /home/ubuntu/rockbed
git add apps/api/src/router.ts apps/web/components/key-manager.tsx packages/shared/src/schemas.ts
git commit -m "feat: daily spend limits per key with auto-disable

Store limit as IAM tag rockbed:dailySpendLimit.
Enforce on page load: disable credential if spend > limit.
Auto-re-enable when new day starts and spend is under limit.
Show limit in key manager with inline edit."
```

---

### Task 8: Hourly Drill-Down API Support

**Files:**
- Modify: `apps/web/app/api/analytics/route.ts`

- [ ] **Step 1: Add granularity and day params to the analytics API**

Add param parsing after the existing params:

```typescript
const granularity = searchParams.get("granularity") ?? "day"; // day | hour
const day = searchParams.get("day"); // YYYY-MM-DD for hourly drill-down
```

When `granularity === "hour"` and `day` is provided, override `startTime`/`endTime` to that single day and change `bin(1d)` to `bin(1h)` in the daily query:

```typescript
let binSize = "bin(1d)";
let queryStart = startTime;
let queryEnd = endTime;

if (granularity === "hour" && day) {
  const dayDate = new Date(day + "T00:00:00Z");
  queryStart = dayDate;
  queryEnd = new Date(dayDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  binSize = "bin(1h)";
}
```

Use `binSize` in the daily query template and `queryStart`/`queryEnd` for the query time range.

- [ ] **Step 2: Update the cost page to fetch hourly data when drillDay is set**

In `cost-page.tsx`, add a second `useAnalytics`-style fetch that fires when `drillDay` is set:

```typescript
const [hourlyData, setHourlyData] = useState<DailyRow[] | null>(null);
const [hourlyLoading, setHourlyLoading] = useState(false);

useEffect(() => {
  if (!drillDay) { setHourlyData(null); return; }
  setHourlyLoading(true);
  const params = new URLSearchParams({
    region, groupBy: "model", year: String(year), month: String(month),
    granularity: "hour", day: drillDay,
  });
  fetch(`/api/analytics?${params}`)
    .then((r) => r.json())
    .then((d) => setHourlyData(d.daily))
    .catch(() => setHourlyData(null))
    .finally(() => setHourlyLoading(false));
}, [drillDay, region, year, month]);
```

Render hourly chart when `drillDay` is set, with a "Back to monthly view" button that sets `drillDay` back to `null`.

On the daily bar chart, add an `onClick` handler to the `<Bar>` that captures the day label and calls `setDrillDay(dayLabel)`. Convert the display label (e.g., "Apr 3") back to `YYYY-MM-DD` for the API call.

- [ ] **Step 3: Commit**

```bash
cd /home/ubuntu/rockbed
git add apps/web/app/api/analytics/route.ts apps/web/components/analytics/cost-page.tsx
git commit -m "feat: adaptive daily→hourly drill-down on cost chart

Click a day bar to see hourly cost breakdown.
Back button returns to monthly view.
API supports granularity=hour&day=YYYY-MM-DD params."
```

---

### Task 9: Build, Test, Deploy

- [ ] **Step 1: Full build**

Run: `cd /home/ubuntu/rockbed && npx turbo build 2>&1 | tail -20`
Expected: All packages build successfully

- [ ] **Step 2: Verify the Docker container builds**

Run: `cd /home/ubuntu/rockbed && docker compose build 2>&1 | tail -10`
Expected: Image builds

- [ ] **Step 3: Deploy to production**

```bash
sshpass -p 'rockbed' ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no -o PreferredAuthentications=password ubuntu@rockbed.zlt.dev "cd /path/to/rockbed && docker compose pull && docker compose up -d"
```

Or if building on the server:

```bash
sshpass -p 'rockbed' ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no -o PreferredAuthentications=password ubuntu@rockbed.zlt.dev "cd rockbed && git pull && docker compose up -d --build"
```

- [ ] **Step 4: Verify the deployed app**

Navigate to `https://rockbed.zlt.dev/settings` and check:
- Total token cost matches our calculated $6,564
- Per-user breakdown expands to show per-model costs
- Cache columns populated for root/Lokesh-dev
- "Cost" label (not "Est. cost") everywhere

- [ ] **Step 5: Final commit with any fixes**

```bash
cd /home/ubuntu/rockbed
git add -A
git commit -m "chore: deployment fixes"
```
