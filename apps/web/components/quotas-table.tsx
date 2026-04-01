"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { client } from "@/lib/orpc";
import { useRegion } from "@/lib/region-context";
import type { BedrockQuota } from "@rockbed/shared";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Pagination } from "@/components/shared/pagination";
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

      <div className="flex gap-8">
        {/* Sidebar filters */}
        <aside className="w-52 shrink-0 space-y-6 sticky top-6 self-start">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Filters</span>
            {(providerFilter !== "all" || inferenceFilter !== "all") && (
              <button
                onClick={() => { setProviderFilter("all"); setInferenceFilter("all"); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Providers</p>
            <div className="space-y-1.5">
              {providers.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm cursor-pointer group/item">
                  <Checkbox
                    checked={providerFilter === p}
                    onCheckedChange={(checked) => setProviderFilter(checked ? p : "all")}
                  />
                  <span className="text-muted-foreground group-hover/item:text-foreground transition-colors text-xs">
                    {p}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Inference type</p>
            <div className="space-y-1.5">
              {inferenceTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer group/item">
                  <Checkbox
                    checked={inferenceFilter === t}
                    onCheckedChange={(checked) => setInferenceFilter(checked ? t : "all")}
                  />
                  <span className="text-muted-foreground group-hover/item:text-foreground transition-colors text-xs">
                    {t}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0">
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
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find quotas..."
          />

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
            <div className="rounded-md border overflow-x-auto">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer select-none hover:text-foreground w-[40%]"
                      onClick={() => toggleSort("quotaName")}
                    >
                      Model <SortIcon field="quotaName" />
                    </TableHead>
                    <TableHead className="w-[20%]">Type</TableHead>
                    <TableHead
                      className="text-right cursor-pointer select-none hover:text-foreground w-[12%]"
                      onClick={() => toggleSort("tpm")}
                    >
                      TPM <SortIcon field="tpm" />
                    </TableHead>
                    <TableHead
                      className="text-right cursor-pointer select-none hover:text-foreground w-[12%]"
                      onClick={() => toggleSort("rpm")}
                    >
                      RPM <SortIcon field="rpm" />
                    </TableHead>
                    <TableHead className="text-right w-[16%]">
                      Increase
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">
                        <span className="block truncate" title={row.modelName}>
                          {row.modelName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {row.inferenceType}
                        </span>
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
      </div>
    </div>
  );
}
