"use client";

import { useState, useEffect, useMemo } from "react";
import { client } from "@/lib/orpc";
import { useRegion } from "@/lib/region-context";
import type { BedrockQuota } from "@rockbed/shared";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableRowsSkeleton } from "@/components/skeletons";
import { ExternalLinkIcon, MoreVerticalIcon } from "lucide-react";

type SortField = "quotaName" | "tpm" | "rpm";
type SortDir = "asc" | "desc";

// Map quota name prefixes to canonical provider names.
// Order matters — longer prefixes first so "AI21 Labs" matches before "AI21".
const PROVIDER_PREFIXES: [string, string][] = [
  ["AI21 Labs", "AI21 Labs"],
  ["Stability.ai", "Stability AI"],
  ["Stability AI", "Stability AI"],
  ["Stable", "Stability AI"],
  ["Mistral AI", "Mistral AI"],
  ["Ministral", "Mistral AI"],
  ["Magistral", "Mistral AI"],
  ["Mistral", "Mistral AI"],
  ["Voxtral", "Mistral AI"],
  ["Moonshot AI", "Moonshot AI"],
  ["Kimi", "Moonshot AI"],
  ["TwelveLabs", "TwelveLabs"],
  ["Twelve", "TwelveLabs"],
  ["Anthropic", "Anthropic"],
  ["Amazon", "Amazon"],
  ["Cohere", "Cohere"],
  ["DeepSeek", "DeepSeek"],
  ["Meta", "Meta"],
  ["MiniMax", "MiniMax"],
  ["Minimax", "MiniMax"],
  ["NVIDIA", "NVIDIA"],
  ["Nemotron", "NVIDIA"],
  ["OpenAI", "OpenAI"],
  ["GPT", "OpenAI"],
  ["Gemma", "Google"],
  ["Qwen3", "Qwen"],
  ["Qwen", "Qwen"],
  ["Writer", "Writer"],
  ["Z.ai", "Z.ai"],
];

function parseQuotaName(name: string) {
  let metric: "TPM" | "RPM" | "Other" = "Other";
  if (/tokens per minute/i.test(name)) metric = "TPM";
  else if (/requests per minute/i.test(name)) metric = "RPM";

  let inferenceType = "On-demand";
  if (/global cross-region/i.test(name)) inferenceType = "Global cross-region";
  else if (/cross-region/i.test(name)) inferenceType = "Geo cross-region";

  const forMatch = name.match(/(?:tokens|requests) per minute for (.+)$/i);
  let modelName: string | null = null;
  let provider: string | null = null;

  if (forMatch) {
    const rest = forMatch[1];
    for (const [prefix, canonical] of PROVIDER_PREFIXES) {
      if (rest.startsWith(prefix + " ") || rest === prefix) {
        provider = canonical;
        // If the prefix IS the canonical provider name, strip it from model name.
        // Otherwise keep it (e.g. "Ministral 14B" stays as-is, provider becomes "Mistral AI").
        if (prefix === canonical) {
          modelName = rest.startsWith(prefix + " ")
            ? rest.slice(prefix.length + 1)
            : rest;
        } else {
          modelName = rest;
        }
        break;
      }
    }
    if (!provider) {
      modelName = rest;
      provider = "Other";
    }
  }

  return { modelName, provider, metric, inferenceType };
}

function formatValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

function getQuotaConsoleUrl(
  accountId: string,
  region: string,
  quotaCode: string
) {
  return `https://${region}.console.aws.amazon.com/servicequotas/home/services/bedrock/quotas/${quotaCode}?region=${region}`;
}

type GroupedRow = {
  modelName: string;
  provider: string;
  inferenceType: string;
  tpm: { value: number; quotaCode: string } | null;
  rpm: { value: number; quotaCode: string } | null;
  adjustable: boolean;
};

export function QuotasTable() {
  const [quotas, setQuotas] = useState<BedrockQuota[]>([]);
  const [accountId, setAccountId] = useState("");
  const { region } = useRegion();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [inferenceFilter, setInferenceFilter] = useState("all");
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "quotaName",
    dir: "asc",
  });
  const [page, setPage] = useState(0);
  const pageSize = 15;
  const [favoriteModelIds, setFavoriteModelIds] = useState<Set<string>>(new Set());
  // Map modelId fragments to favorite status for matching against quota model names
  const [favoriteNames, setFavoriteNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      client.favorites.list(),
      client.models.list({ region }),
    ]).then(([favIds, models]) => {
      setFavoriteModelIds(new Set(favIds));
      // Build set of model names that are favorited
      const names = new Set<string>();
      for (const m of models) {
        if (favIds.includes(m.modelId)) {
          names.add(m.modelName.toLowerCase());
        }
      }
      setFavoriteNames(names);
    }).catch(() => {});
  }, [region]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      client.quotas.list({ region }),
      client.identity.whoAmI({ region }),
    ])
      .then(([q, id]) => {
        setQuotas(q);
        setAccountId(id.account);
      })
      .catch((err: any) => setError(err.message ?? "Failed to load quotas"))
      .finally(() => setLoading(false));
  }, [region]);

  const rows = useMemo(() => {
    return quotas.map((q) => ({ ...q, parsed: parseQuotaName(q.quotaName) }));
  }, [quotas]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.parsed.provider) set.add(r.parsed.provider);
    return Array.from(set).sort();
  }, [rows]);

  const inferenceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.parsed.inferenceType);
    return Array.from(set).sort();
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedRow>();
    for (const r of rows) {
      const p = r.parsed;
      if (!p.modelName || !p.provider) continue;
      const key = `${p.modelName}|${p.provider}|${p.inferenceType}`;
      if (!map.has(key)) {
        map.set(key, {
          modelName: p.modelName,
          provider: p.provider,
          inferenceType: p.inferenceType,
          tpm: null,
          rpm: null,
          adjustable: r.adjustable,
        });
      }
      const entry = map.get(key)!;
      if (p.metric === "TPM")
        entry.tpm = { value: r.value, quotaCode: r.quotaCode };
      else if (p.metric === "RPM")
        entry.rpm = { value: r.value, quotaCode: r.quotaCode };
      if (r.adjustable) entry.adjustable = true;
    }
    return Array.from(map.values());
  }, [rows]);

  const filtered = useMemo(() => {
    let result = grouped.filter((r) => {
      if (providerFilter !== "all" && r.provider !== providerFilter)
        return false;
      if (inferenceFilter !== "all" && r.inferenceType !== inferenceFilter)
        return false;
      if (
        search &&
        !r.modelName.toLowerCase().includes(search.toLowerCase()) &&
        !r.provider.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
    const hasFilters =
      providerFilter !== "all" ||
      inferenceFilter !== "all" ||
      search.length > 0;

    result.sort((a, b) => {
      // Favorites first when no filters
      if (!hasFilters && favoriteNames.size > 0) {
        const aFav = favoriteNames.has(a.modelName.toLowerCase()) ? 0 : 1;
        const bFav = favoriteNames.has(b.modelName.toLowerCase()) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
      }
      let cmp: number;
      if (sort.field === "quotaName") cmp = a.modelName.localeCompare(b.modelName);
      else if (sort.field === "tpm") cmp = (a.tpm?.value ?? 0) - (b.tpm?.value ?? 0);
      else cmp = (a.rpm?.value ?? 0) - (b.rpm?.value ?? 0);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [grouped, favoriteNames, providerFilter, inferenceFilter, search, sort]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(field: SortField) {
    setSort((s) =>
      s.field === field
        ? { field, dir: s.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sort.field !== field) return <span className="text-muted-foreground/30 ml-1">↕</span>;
    return <span className="ml-1">{sort.dir === "asc" ? "↑" : "↓"}</span>;
  }

  useEffect(() => {
    setPage(0);
  }, [search, providerFilter, inferenceFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quotas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View approved model quotas for your account and request quota
          increases.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Quotas by model
              {!loading && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({filtered.length})
                </span>
              )}
            </CardTitle>
            {totalPages > 1 && (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  ‹
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i)
                  .filter(
                    (i) =>
                      i === 0 ||
                      i === totalPages - 1 ||
                      Math.abs(i - page) <= 1
                  )
                  .reduce<(number | "...")[]>((acc, i) => {
                    const last = acc[acc.length - 1];
                    if (typeof last === "number" && i - last > 1) acc.push("...");
                    acc.push(i);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    item === "..." ? (
                      <span
                        key={`dots-${idx}`}
                        className="w-7 text-center text-xs text-muted-foreground"
                      >
                        ...
                      </span>
                    ) : (
                      <Button
                        key={item}
                        variant={page === item ? "default" : "ghost"}
                        size="sm"
                        className="h-7 w-7 p-0 text-xs"
                        onClick={() => setPage(item)}
                      >
                        {item + 1}
                      </Button>
                    )
                  )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  ›
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find quotas..."
              className="max-w-xs"
            />
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any provider</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={inferenceFilter} onValueChange={setInferenceFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Inference type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any inference type</SelectItem>
                {inferenceTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {loading ? (
            <TableRowsSkeleton
              cols={6}
              rows={12}
              widths={["w-36", "w-20", "w-28", "w-12", "w-12", "w-20"]}
            />
          ) : error ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No quotas match your filters.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer select-none hover:text-foreground"
                      onClick={() => toggleSort("quotaName")}
                    >
                      Model name <SortIcon field="quotaName" />
                    </TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Inference type</TableHead>
                    <TableHead
                      className="text-right cursor-pointer select-none hover:text-foreground"
                      onClick={() => toggleSort("tpm")}
                    >
                      TPM <SortIcon field="tpm" />
                    </TableHead>
                    <TableHead
                      className="text-right cursor-pointer select-none hover:text-foreground"
                      onClick={() => toggleSort("rpm")}
                    >
                      RPM <SortIcon field="rpm" />
                    </TableHead>
                    <TableHead className="text-right w-48">
                      Request quota increase
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">
                        {row.modelName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.provider}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-normal">
                          {row.inferenceType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.tpm ? formatValue(row.tpm.value) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {row.rpm ? formatValue(row.rpm.value) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.adjustable ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors">
                              <MoreVerticalIcon className="size-4 text-muted-foreground" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-56">
                              {row.tpm && (
                                <DropdownMenuItem
                                  className="gap-2 py-2"
                                  onClick={() =>
                                    window.open(
                                      getQuotaConsoleUrl(accountId, region, row.tpm!.quotaCode),
                                      "_blank"
                                    )
                                  }
                                >
                                  <ExternalLinkIcon className="size-4 text-muted-foreground" />
                                  Request TPM quota increase
                                </DropdownMenuItem>
                              )}
                              {row.rpm && (
                                <DropdownMenuItem
                                  className="gap-2 py-2"
                                  onClick={() =>
                                    window.open(
                                      getQuotaConsoleUrl(accountId, region, row.rpm!.quotaCode),
                                      "_blank"
                                    )
                                  }
                                >
                                  <ExternalLinkIcon className="size-4 text-muted-foreground" />
                                  Request RPM quota increase
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Not supported
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
