"use client";

import { useState, useMemo, useEffect } from "react";
import { client } from "@/lib/orpc";
import { useRegion } from "@/lib/region-context";
import {
  useAnalytics,
  formatNumber,
  formatCurrency,
  calculateCost,
  monthName,
  CHART_COLORS,
  sanitizeKey,
  type AnalyticsFilters,
} from "./use-analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Pie,
  PieChart,
  Cell,
} from "recharts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

export function CostPage() {
  const now = new Date();
  const { region } = useRegion();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [groupBy, setGroupBy] = useState("user");
  const [filterUser, setFilterUser] = useState("");
  const [apiKeys, setApiKeys] = useState<{ name: string; userName: string }[]>([]);

  useEffect(() => {
    client.keys.list({ region }).then((keys) =>
      setApiKeys(keys.map((k) => ({ name: k.friendlyName, userName: k.userName })))
    ).catch(() => {});
  }, [region]);

  const filters: AnalyticsFilters = {};
  if (filterUser) filters.user = filterUser;

  const { data: modelData, loading: modelLoading } = useAnalytics("model", year, month, filters);
  const { data: groupData, loading: groupLoading } = useAnalytics(groupBy, year, month, filters);
  const loading = modelLoading || groupLoading;
  const data = groupBy === "model" ? modelData : groupData;

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  }

  // Calculate costs from model data (need model names for pricing)
  const totalCost = useMemo(() => {
    if (!modelData?.summary.length) return 0;
    return modelData.summary.reduce(
      (acc, r) => acc + calculateCost(r.groupKey, r.totalIn, r.totalOut),
      0
    );
  }, [modelData]);

  // Pie chart data by model
  const pieData = useMemo(() => {
    if (!modelData?.summary.length) return [];
    return modelData.summary
      .map((r) => ({
        name: r.groupKey,
        value: calculateCost(r.groupKey, r.totalIn, r.totalOut),
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [modelData]);

  const pieConfig = useMemo(() => {
    const config: Record<string, { label: string; color: string }> = {};
    pieData.forEach((d, i) => {
      config[sanitizeKey(d.name)] = { label: d.name, color: CHART_COLORS[i % CHART_COLORS.length] };
    });
    return config;
  }, [pieData]);

  // Daily cost chart
  const { dailyCostData, dailyConfig, dailyKeys } = useMemo(() => {
    if (!modelData?.daily.length) return { dailyCostData: [], dailyConfig: {}, dailyKeys: [] };

    const rawKeys = [...new Set(modelData.daily.map((d) => d.groupKey))];
    const keyMap = new Map(rawKeys.map((k) => [k, sanitizeKey(k)]));
    const safeKeys = rawKeys.map((k) => keyMap.get(k)!);

    const byDay = new Map<string, Record<string, number>>();
    for (const row of modelData.daily) {
      const dayKey = new Date(row.day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!byDay.has(dayKey)) byDay.set(dayKey, {});
      const entry = byDay.get(dayKey)!;
      entry.day = dayKey as any;
      const safe = keyMap.get(row.groupKey)!;
      entry[safe] =
        (entry[safe] ?? 0) + calculateCost(row.groupKey, row.totalIn, row.totalOut);
    }

    const config: Record<string, { label: string; color: string }> = {};
    rawKeys.forEach((k, i) => {
      config[keyMap.get(k)!] = { label: k, color: CHART_COLORS[i % CHART_COLORS.length] };
    });

    return {
      dailyCostData: Array.from(byDay.values()),
      dailyConfig: config,
      dailyKeys: safeKeys,
    };
  }, [modelData]);

  // Breakdown table (uses the selected groupBy data)
  const costBreakdown = useMemo(() => {
    if (groupBy === "model" && modelData?.summary) {
      return modelData.summary.map((r) => ({
        ...r,
        cost: calculateCost(r.groupKey, r.totalIn, r.totalOut),
      }));
    }
    // For apiKey/user groupBy, estimate cost using blended rate
    if (data?.summary) {
      return data.summary.map((r) => ({
        ...r,
        // Use a blended estimate: ~$5/M in, ~$20/M out (weighted avg)
        cost: calculateCost("blended", r.totalIn, r.totalOut),
      }));
    }
    return [];
  }, [data, modelData, groupBy]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cost</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estimated costs based on Bedrock on-demand pricing.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={groupBy} onValueChange={(v) => v && setGroupBy(v)}>
          <SelectTrigger className="w-44">
            <span>Group by: {groupBy === "apiKey" ? "API Key" : groupBy === "user" ? "User" : "Model"}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="model">Model</SelectItem>
            <SelectItem value="apiKey">API Key</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterUser || "_all"} onValueChange={(v) => setFilterUser(!v || v === "_all" ? "" : v)}>
          <SelectTrigger className="w-44">
            <span>API key: {filterUser ? apiKeys.find(k => k.userName === filterUser)?.name ?? filterUser : "All"}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All</SelectItem>
            {apiKeys.map((k) => (
              <SelectItem key={k.userName} value={k.userName}>
                {k.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 border rounded-lg px-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={prevMonth}>
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="text-sm font-medium px-2 min-w-[120px] text-center">
            {monthName(month)} {year}
          </span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={nextMonth}>
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Cost summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total token cost</p>
              {loading ? (
                <Skeleton className="h-8 w-32 mt-1" />
              ) : (
                <p className="text-2xl font-bold mt-1">{formatCurrency(totalCost)}</p>
              )}
            </div>
            {!loading && pieData.length > 0 && (
              <ChartContainer config={pieConfig} className="size-20">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={25}
                    outerRadius={38}
                    strokeWidth={2}
                  >
                    {pieData.map((d, i) => (
                      <Cell
                        key={`${d.name}-${i}`}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Total tokens in</p>
            {loading ? (
              <Skeleton className="h-8 w-32 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1">
                {formatNumber(
                  modelData?.summary.reduce((a, r) => a + r.totalIn, 0) ?? 0
                )}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Total tokens out</p>
            {loading ? (
              <Skeleton className="h-8 w-32 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1">
                {formatNumber(
                  modelData?.summary.reduce((a, r) => a + r.totalOut, 0) ?? 0
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily cost chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily token cost</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-80 w-full" />
          ) : dailyCostData.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
              No cost data for this period.
            </div>
          ) : (
            <ChartContainer config={dailyConfig} className="h-80 w-full">
              <BarChart data={dailyCostData} barCategoryGap="20%">
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  tickFormatter={(v) => `$${formatNumber(v)}`}
                />
                <ChartTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                        <p className="font-medium mb-1.5">{label}</p>
                        {payload.filter((p: any) => p.value > 0).map((p: any) => (
                          <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
                            <span className="size-2.5 rounded-full shrink-0" style={{ background: p.fill }} />
                            <span className="text-muted-foreground">{dailyConfig[p.dataKey]?.label ?? p.dataKey}:</span>
                            <span className="font-mono font-medium ml-auto">{formatCurrency(p.value)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <ChartLegend content={<ChartLegendContent />} />
                {dailyKeys.map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="cost"
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    radius={[0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Cost breakdown */}
      {costBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Cost breakdown by {groupBy === "apiKey" ? "API key" : groupBy}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium text-muted-foreground">
                      {groupBy === "apiKey" ? "API Key" : groupBy === "user" ? "User" : "Model"}
                    </th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Tokens in</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Tokens out</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Invocations</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costBreakdown.map((row, i) => (
                    <tr key={`${row.groupKey}-${i}`} className="border-b last:border-0">
                      <td className="p-3 font-medium">{row.groupKey}</td>
                      <td className="p-3 text-right font-mono">{formatNumber(row.totalIn)}</td>
                      <td className="p-3 text-right font-mono">{formatNumber(row.totalOut)}</td>
                      <td className="p-3 text-right font-mono">{formatNumber(row.invocations)}</td>
                      <td className="p-3 text-right font-mono">{formatCurrency(row.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
