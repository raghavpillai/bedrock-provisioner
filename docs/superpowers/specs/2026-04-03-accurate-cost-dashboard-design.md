# Accurate Cost Dashboard & Daily Spend Limits

## Problem

The cost page shows two different numbers for what should be the same thing:

- **Total token cost**: calculated per-model using actual model pricing (accurate)
- **Cost per user/key**: calculated using a flat "blended" rate of $3/$15 per 1M tokens (inaccurate)

The sum of per-user costs never matches the total. Additionally, the hardcoded pricing table is wrong for newer models (Opus 4.5/4.6 at $15/$75 instead of correct $5/$25, Haiku 4.5 at $0.80/$4 instead of $1/$5).

Cache token data exists in CloudWatch logs but isn't surfaced anywhere, and there's no mechanism to limit spend per key.

## Corrected Pricing (from Anthropic official docs, verified 2026-04-03)

| Model | Input/MTok | Output/MTok | 5m Cache Write | 1h Cache Write | Cache Read |
|-------|-----------|------------|----------------|----------------|------------|
| Opus 4.6 | $5.00 | $25.00 | $6.25 | $10.00 | $0.50 |
| Opus 4.5 | $5.00 | $25.00 | $6.25 | $10.00 | $0.50 |
| Opus 4.1 | $15.00 | $75.00 | $18.75 | $30.00 | $1.50 |
| Opus 4 | $15.00 | $75.00 | $18.75 | $30.00 | $1.50 |
| Sonnet 4.6 | $3.00 | $15.00 | $3.75 | $6.00 | $0.30 |
| Sonnet 4.5 | $3.00 | $15.00 | $3.75 | $6.00 | $0.30 |
| Sonnet 4 | $3.00 | $15.00 | $3.75 | $6.00 | $0.30 |
| Haiku 4.5 | $1.00 | $5.00 | $1.25 | $2.00 | $0.10 |
| Haiku 3.5 | $0.80 | $4.00 | $1.00 | $1.60 | $0.08 |
| Haiku 3 | $0.25 | $1.25 | $0.30 | $0.50 | $0.03 |

Long context (1M window for Opus 4.6/Sonnet 4.6): no separate pricing — standard rates apply.
Source: https://platform.claude.com/docs/en/about-claude/pricing

## Real Data Context (from CloudWatch, 2026-04-03)

- 26,450 invocations across 14 keys in the last 30 days
- omer-evals burned $16,555 on Opus 4.6 (15.8K invocations, zero caching)
- root saves significantly via caching: 512M cache read tokens on Opus
- Only 3 of 14 keys use prompt caching at all
- Cache fields (`input.cacheReadInputTokenCount`, `input.cacheWriteInputTokenCount`) are top-level fields in Bedrock CloudWatch invocation logs — directly queryable

## Changes

### 1. Pricing Engine (`packages/shared/src/pricing.ts`)

Update `calculateCost` signature:

```ts
calculateCost(
  modelKey: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0
): number
```

Cost formula:
- Regular input: `inputTokens / 1M * inputPrice`
- Cache read: `cacheReadTokens / 1M * inputPrice * 0.10`
- Cache write: `cacheWriteTokens / 1M * inputPrice * 1.25`
- Output: `outputTokens / 1M * outputPrice`

Remove "Est." from all labels. It's now exact.

Pricing table stays hardcoded (AWS Pricing API is incomplete for newer models). Update to correct values per the table above. Key fixes: Opus 4.5/4.6 from $15/$75 to $5/$25, Haiku 4.5 from $0.80/$4 to $1/$5.

### 2. Analytics API (`apps/web/app/api/analytics/route.ts`)

Single query shape for all groupBy modes. Always group by both `modelId` AND `identity.arn`:

```sql
fields input.inputTokenCount as inTok,
       output.outputTokenCount as outTok,
       coalesce(input.cacheReadInputTokenCount, 0) as cacheReadTok,
       coalesce(input.cacheWriteInputTokenCount, 0) as cacheWriteTok,
       modelId, identity.arn as userArn
| stats sum(inTok) as totalIn, sum(outTok) as totalOut,
        sum(cacheReadTok) as cacheRead, sum(cacheWriteTok) as cacheWrite,
        count(*) as invocations
  by bin(1d) as day, modelId, identity.arn
| sort day asc
```

Summary query is the same without `bin(1d)` and `day`.

API response shape changes to flat two-dimensional rows:

```ts
{
  day?: string;
  userKey: string;
  modelKey: string;
  totalIn: number;
  totalOut: number;
  cacheRead: number;
  cacheWrite: number;
  invocations: number;
}
```

Frontend groups/aggregates as needed. The `groupBy` URL param only controls IAM username→email resolution, not the query shape.

### 3. Key Analytics API (`apps/web/app/api/analytics/keys/route.ts`)

Same two-dimensional query change. Cache fields included. All `calculateCost("blended", ...)` calls removed.

### 4. Cost Page (`apps/web/components/analytics/cost-page.tsx`)

**Summary cards:**
- Total cost (from model-level aggregation, with cache-aware pricing)
- Total tokens in
- Total tokens out
- Total cache read tokens (new card)

**Breakdown table — expandable rows:**
- Collapsed user row: user name | tokens in | tokens out | cache read | cache write | invocations | cost
- Expanded: per-model sub-rows with same columns
- User cost = sum of model sub-row costs (each using that model's actual rate)
- No blended estimates anywhere

**Daily chart — adaptive drill-down:**
- Default: daily bars for the full month (existing behavior)
- Click a day bar: drill into hourly view for that day (`bin(1h)`)
- Back button returns to monthly view

### 5. Key Manager (`apps/web/components/key-manager.tsx`)

Replace all `calculateCost("blended", ...)` with actual per-model costs from two-dimensional data. Add cache columns to the key table.

### 6. Daily Spend Limits (new)

**Storage:** IAM user tag `rockbed:dailySpendLimit` (e.g., `"100.00"` or `"none"`). No DB migration needed. Configurable per key in Rockbed UI settings.

**Enforcement mechanism:**
- On each cost page / key manager load, the API calculates today's spend per key from CloudWatch
- If a key's daily spend exceeds its limit, call `UpdateServiceSpecificCredential` with `Status: Inactive`
- Store original status in tag `rockbed:autoDisabledAt` so it can be distinguished from manually disabled keys
- Re-enable at midnight UTC (cron job or on first API hit of the new day)

**IAM API used:** `UpdateServiceSpecificCredential` — params: `ServiceSpecificCredentialId`, `Status` (Active/Inactive), `UserName` (optional).

**UI:** Per-key daily limit field in key settings. Visual indicator when a key is auto-disabled due to limit.

## Files Modified

| File | Change |
|------|--------|
| `packages/shared/src/pricing.ts` | Add cache params to `calculateCost`, update formula |
| `apps/web/app/api/analytics/route.ts` | Two-dimensional query, cache fields, new response shape |
| `apps/web/app/api/analytics/keys/route.ts` | Same two-dimensional + cache changes |
| `apps/web/components/analytics/cost-page.tsx` | Expandable rows, cache columns, hourly drill-down, no blended |
| `apps/web/components/analytics/use-analytics.ts` | Update types and aggregation helpers |
| `apps/web/components/key-manager.tsx` | Remove blended costs, use per-model data, cache columns |
| `apps/api/src/router.ts` | Add daily limit tag handling, auto-disable logic |

## Out of Scope

- Programmatic pricing from AWS Pricing API (incomplete, hardcode is more reliable)
- 1-hour cache TTL distinction (CloudWatch doesn't separate at top level)
- Real-time streaming cost monitoring (polling on page load is sufficient)
- Email/Slack notifications for spend alerts (future enhancement)
