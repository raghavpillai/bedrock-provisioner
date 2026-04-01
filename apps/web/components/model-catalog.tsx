"use client";

import { useState, useEffect, useMemo } from "react";
import { client } from "@/lib/orpc";
import { useRegion } from "@/lib/region-context";
import type { BedrockModel } from "@rockbed/shared";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
// Select removed — region is now in sidebar context
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FiltersSkeleton, TableRowsSkeleton } from "@/components/skeletons";
import { CopyButton } from "@/components/shared/copy-button";
import { Pagination } from "@/components/shared/pagination";
import {
  StarIcon,
  TypeIcon,
  ImageIcon,
  VideoIcon,
  MicIcon,
  AudioLinesIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";

type SortField = "modelName" | "provider";
type SortDir = "asc" | "desc";

export function ModelCatalog() {
  const [models, setModels] = useState<BedrockModel[]>([]);
  const { region } = useRegion();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(
    new Set()
  );
  const [selectedInputMods, setSelectedInputMods] = useState<Set<string>>(
    new Set()
  );
  const [selectedOutputMods, setSelectedOutputMods] = useState<Set<string>>(
    new Set()
  );
  const [search, setSearch] = useState("");
  const [selectedModel, setSelectedModel] = useState<BedrockModel | null>(null);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "modelName",
    dir: "asc",
  });
  const [page, setPage] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    client.favorites.list().then((ids) => setFavorites(new Set(ids)));
  }, []);

  async function toggleFavorite(modelId: string) {
    const res = await client.favorites.toggle({ modelId });
    setFavorites((prev) => {
      const next = new Set(prev);
      if (res.favorited) next.add(modelId);
      else next.delete(modelId);
      return next;
    });
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    client.models
      .list({ region })
      .then(setModels)
      .catch((err: any) => setError(err.message ?? "Failed to load models"))
      .finally(() => setLoading(false));
  }, [region]);

  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of models)
      counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [models]);

  const inputModalities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of models)
      for (const mod of m.inputModalities)
        counts.set(mod, (counts.get(mod) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [models]);

  const outputModalities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of models)
      for (const mod of m.outputModalities)
        counts.set(mod, (counts.get(mod) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [models]);

  const filtered = useMemo(() => {
    let result = models.filter((m) => {
      if (selectedProviders.size > 0 && !selectedProviders.has(m.provider))
        return false;
      if (
        selectedInputMods.size > 0 &&
        !m.inputModalities.some((mod) => selectedInputMods.has(mod))
      )
        return false;
      if (
        selectedOutputMods.size > 0 &&
        !m.outputModalities.some((mod) => selectedOutputMods.has(mod))
      )
        return false;
      if (
        search &&
        !m.modelName.toLowerCase().includes(search.toLowerCase()) &&
        !m.modelId.toLowerCase().includes(search.toLowerCase()) &&
        !m.provider.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
    const hasFilters =
      selectedProviders.size > 0 ||
      selectedInputMods.size > 0 ||
      selectedOutputMods.size > 0 ||
      search.length > 0;

    result.sort((a, b) => {
      // Favorites first when no filters are active
      if (!hasFilters) {
        const aFav = favorites.has(a.modelId) ? 0 : 1;
        const bFav = favorites.has(b.modelId) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
      }
      const cmp =
        sort.field === "modelName"
          ? a.modelName.localeCompare(b.modelName)
          : a.provider.localeCompare(b.provider);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [
    models,
    favorites,
    selectedProviders,
    selectedInputMods,
    selectedOutputMods,
    search,
    sort,
  ]);

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
    if (sort.field !== field)
      return <span className="text-muted-foreground/30 ml-1">↕</span>;
    return <span className="ml-1">{sort.dir === "asc" ? "↑" : "↓"}</span>;
  }

  function toggleFilter(
    set: Set<string>,
    setter: (s: Set<string>) => void,
    value: string
  ) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  const activeFilterCount =
    selectedProviders.size + selectedInputMods.size + selectedOutputMods.size;

  useEffect(() => {
    setPage(0);
  }, [search, selectedProviders, selectedInputMods, selectedOutputMods]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Model Catalog</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Discover Bedrock foundation models that best fit your use case.
        </p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar */}
        {loading ? (
          <FiltersSkeleton />
        ) : (
          <aside className="w-52 shrink-0 space-y-6 sticky top-6 self-start">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Filters</span>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    setSelectedProviders(new Set());
                    setSelectedInputMods(new Set());
                    setSelectedOutputMods(new Set());
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            <FilterGroup
              title="Providers"
              items={providers}
              selected={selectedProviders}
              onToggle={(v) =>
                toggleFilter(selectedProviders, setSelectedProviders, v)
              }
            />
            <FilterGroup
              title="Input modalities"
              items={inputModalities}
              selected={selectedInputMods}
              onToggle={(v) =>
                toggleFilter(selectedInputMods, setSelectedInputMods, v)
              }
            />
            <FilterGroup
              title="Output modalities"
              items={outputModalities}
              selected={selectedOutputMods}
              onToggle={(v) =>
                toggleFilter(selectedOutputMods, setSelectedOutputMods, v)
              }
            />
          </aside>
        )}

        {/* Table */}
        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Models
                  {!loading && (
                    <span className="text-muted-foreground font-normal ml-2">
                      ({filtered.length})
                    </span>
                  )}
                </CardTitle>
                {totalPages > 1 && (
                  <Pagination
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models by name, ID, or provider..."
              />

              {loading ? (
                <TableRowsSkeleton
                  cols={5}
                  rows={10}
                  widths={["w-40", "w-20", "w-32", "w-24", "w-14"]}
                />
              ) : error ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  No models match your filters.
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead
                          className="cursor-pointer select-none hover:text-foreground"
                          onClick={() => toggleSort("modelName")}
                        >
                          Model name <SortIcon field="modelName" />
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none hover:text-foreground"
                          onClick={() => toggleSort("provider")}
                        >
                          Provider <SortIcon field="provider" />
                        </TableHead>
                        <TableHead>Input</TableHead>
                        <TableHead>Output</TableHead>
                        <TableHead className="w-20">Status</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paged.map((model) => (
                        <TableRow
                          key={model.modelId}
                          className="cursor-pointer"
                          onClick={() => setSelectedModel(model)}
                        >
                          <TableCell>
                            <p className="font-medium text-sm whitespace-nowrap">
                              {model.modelName}
                            </p>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {model.provider}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1.5">
                              {model.inputModalities.map((mod) => (
                                <ModalityIcon key={mod} modality={mod} />
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1.5">
                              {model.outputModalities.map((mod) => (
                                <ModalityIcon key={mod} modality={mod} />
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                model.lifecycleStatus === "ACTIVE"
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {model.lifecycleStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(model.modelId);
                              }}
                              className="p-1 rounded hover:bg-muted transition-colors"
                            >
                              <StarIcon
                                className={`size-4 ${
                                  favorites.has(model.modelId)
                                    ? "fill-amber-400 text-amber-400"
                                    : "text-muted-foreground/30"
                                }`}
                              />
                            </button>
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

      {/* Model detail dialog */}
      <ModelDetailDialog
        model={selectedModel}
        onClose={() => setSelectedModel(null)}
      />
    </div>
  );
}

// Pagination imported from shared

function FilterGroup({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string;
  items: [string, number][];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.map(([value, count]) => (
          <label
            key={value}
            className="flex items-center gap-2 text-sm cursor-pointer group/item"
          >
            <Checkbox
              checked={selected.has(value)}
              onCheckedChange={() => onToggle(value)}
            />
            <span className="text-muted-foreground group-hover/item:text-foreground transition-colors text-xs">
              {value}
            </span>
            <span className="text-muted-foreground/40 text-[10px] ml-auto">
              {count}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ModalityIcon({ modality }: { modality: string }) {
  const m = modality.toUpperCase();
  const iconClass = "size-4 text-muted-foreground";
  let icon = <TypeIcon className={iconClass} />;
  let label = modality;
  if (m === "TEXT") { icon = <TypeIcon className={iconClass} />; label = "Text"; }
  else if (m === "IMAGE") { icon = <ImageIcon className={iconClass} />; label = "Image"; }
  else if (m === "VIDEO") { icon = <VideoIcon className={iconClass} />; label = "Video"; }
  else if (m === "AUDIO") { icon = <AudioLinesIcon className={iconClass} />; label = "Audio"; }
  else if (m === "SPEECH") { icon = <MicIcon className={iconClass} />; label = "Speech"; }
  else if (m === "EMBEDDING") { icon = <TypeIcon className={iconClass} />; label = "Embed"; }
  return (
    <span className="flex items-center gap-1" title={label}>
      {icon}
    </span>
  );
}

// CopyButton imported from shared

function ModelDetailDialog({
  model,
  onClose,
}: {
  model: BedrockModel | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!model} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!max-w-2xl">
        {model && (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-4 pr-6">
                <div>
                  <DialogTitle className="text-lg">
                    {model.modelName}
                  </DialogTitle>
                  <DialogDescription>
                    By: {model.provider}
                  </DialogDescription>
                </div>
                <Badge
                  variant={
                    model.lifecycleStatus === "ACTIVE"
                      ? "default"
                      : "secondary"
                  }
                  className="shrink-0"
                >
                  {model.lifecycleStatus}
                </Badge>
              </div>
            </DialogHeader>

            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-muted-foreground w-36 font-medium text-sm align-top">
                      Model ID
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-sm bg-muted px-2 py-0.5 rounded truncate">
                          {model.modelId}
                        </code>
                        <CopyButton text={model.modelId} />
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium text-sm align-top">
                      Model ARN
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <code className="text-xs text-muted-foreground break-all min-w-0">
                          {model.modelArn}
                        </code>
                        <CopyButton text={model.modelArn} />
                      </div>
                    </TableCell>
                  </TableRow>
                  {model.releaseDate && (
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium text-sm">
                        Release date
                      </TableCell>
                      <TableCell>
                        {new Date(model.releaseDate).toUTCString()}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium text-sm">
                      Input modalities
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {model.inputModalities.map((mod) => (
                          <span key={mod} className="flex items-center gap-1.5 text-sm">
                            <ModalityIcon modality={mod} />
                            {mod}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium text-sm">
                      Output modalities
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {model.outputModalities.map((mod) => (
                          <span key={mod} className="flex items-center gap-1.5 text-sm">
                            <ModalityIcon modality={mod} />
                            {mod}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium text-sm">
                      Streaming
                    </TableCell>
                    <TableCell>
                      {model.streaming ? (
                        <Badge variant="default" className="text-xs">
                          Supported
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">
                          Not supported
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium text-sm">
                      Inference types
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {model.inferenceTypes.length > 0
                          ? model.inferenceTypes.map((t) => (
                              <Badge
                                key={t}
                                variant="secondary"
                                className="text-xs"
                              >
                                {t.replace(/_/g, " ")}
                              </Badge>
                            ))
                          : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {model.customizations.length > 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium text-sm">
                        Customizations
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {model.customizations.map((c) => (
                            <Badge
                              key={c}
                              variant="secondary"
                              className="text-xs"
                            >
                              {c}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
