"use client";

import { useState, useEffect, useCallback } from "react";
import { client } from "@/lib/orpc";
import { useRegion } from "@/lib/region-context";
import { useSession } from "@/lib/auth-client";
import { EXPIRY_PRESETS, calculateCost } from "@rockbed/shared";
import { CopyButton } from "@/components/shared/copy-button";
import { CheckIcon } from "lucide-react";
import type { BedrockKey, NewBedrockKey } from "@rockbed/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { TableRowsSkeleton } from "@/components/skeletons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type KeyStats = Record<string, {
  mtdIn: number; mtdOut: number; mtdInv: number;
  recentIn: number; recentOut: number; recentInv: number;
  lastUsed: string | null;
}>;

export function KeyManager() {
  const { region } = useRegion();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [keys, setKeys] = useState<BedrockKey[]>([]);
  const [keyStats, setKeyStats] = useState<KeyStats>({});
  const [newKey, setNewKey] = useState<NewBedrockKey | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    userName: string;
    credentialId: string;
    friendlyName: string;
  } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createExpiryPreset, setCreateExpiryPreset] = useState("0");
  const [createExpiryDays, setCreateExpiryDays] = useState(0);
  const [createCustomDays, setCreateCustomDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const keyList = await client.keys.list({ region });
      setKeys(keyList);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "Failed to load keys");
    } finally {
      setRefreshing(false);
    }
  }, [region]);

  // Stable key identity string to avoid re-fetching stats on every render
  const keysFingerprint = keys.map((k) => `${k.friendlyName}:${k.createdAt}`).join(",");

  // Fetch per-key usage stats (scoped to active key creation dates)
  useEffect(() => {
    if (keys.length === 0 && refreshing) return;
    const activeKeys: Record<string, string> = {};
    for (const k of keys) {
      activeKeys[k.friendlyName] = k.createdAt;
    }
    const params = new URLSearchParams({ region });
    if (Object.keys(activeKeys).length > 0) {
      params.set("activeKeys", JSON.stringify(activeKeys));
    }
    fetch(`/api/analytics/keys?${params}`)
      .then((r) => r.json())
      .then(setKeyStats)
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, keysFingerprint, refreshing]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleExpiryChange(value: string | null) {
    if (!value) return;
    setCreateExpiryPreset(value);
    const days = parseInt(value, 10);
    if (days >= 0) {
      setCreateExpiryDays(days);
      setCreateCustomDays("");
    }
  }

  function openCreateDialog() {
    setCreateName("");
    setCreateExpiryPreset("0");
    setCreateExpiryDays(0);
    setCreateCustomDays("");
    setCreateError(null);
    setNewKey(null);
    setCreateOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    const finalDays =
      createExpiryPreset === "-1"
        ? parseInt(createCustomDays, 10) || 0
        : createExpiryDays;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await client.keys.create({
        name: createName.trim(),
        region,
        expiryDays: finalDays,
        createdBy: session?.user?.email ?? undefined,
      });
      setNewKey(created);
      setCreateOpen(false);
      await refresh();
    } catch (err: any) {
      setCreateError(err.message ?? "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const { userName, credentialId } = deleteTarget;
    setDeleting(credentialId);
    setDeleteTarget(null);
    try {
      await client.keys.delete({ userName, credentialId, region });
      setNewKey(null);
      await refresh();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete key");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {newKey && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2">
            <div className="size-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckIcon className="size-3 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-foreground">
              Key created &mdash; copy it now, it won&apos;t be shown again.
            </p>
          </div>
          <div className="rounded-md bg-background/80 border border-border/60 divide-y divide-border/60 text-sm">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground text-xs">Name</span>
              <code className="text-xs font-medium">{newKey.apiKeyId}</code>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">API key</span>
                <CopyButton text={newKey.apiKey} label="API key" />
              </div>
              <code className="text-xs font-mono block break-all bg-muted rounded px-2 py-1.5 text-foreground select-all">
                {newKey.apiKey}
              </code>
            </div>
            {newKey.expiresAt && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground text-xs">Expires</span>
                <span className="text-xs font-medium">
                  {new Date(newKey.expiresAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              API keys
              {!refreshing && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({keys.length})
                </span>
              )}
            </CardTitle>
            <Button onClick={openCreateDialog}>Create key</Button>
          </div>
        </CardHeader>
        <CardContent>
          {refreshing && keys.length === 0 ? (
            <TableRowsSkeleton cols={6} rows={3} />
          ) : keys.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No API keys yet.</p>
              <Button variant="outline" onClick={openCreateDialog}>
                Create your first key
              </Button>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>API key ID</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Created by</TableHead>
                    <TableHead className="text-right">This month</TableHead>
                    <TableHead className="text-right">Lifetime</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.credentialId}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {key.friendlyName}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger className="text-xs text-muted-foreground cursor-default font-mono">
                            {key.apiKeyId.length > 30
                              ? `${key.apiKeyId.slice(0, 14)}...${key.apiKeyId.slice(-12)}`
                              : key.apiKeyId}
                          </TooltipTrigger>
                          <TooltipContent>
                            <code className="text-xs">{key.apiKeyId}</code>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {key.createdBy ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(() => {
                          const s = keyStats[key.friendlyName];
                          if (!s || !s.mtdInv) return <span className="text-muted-foreground text-xs">—</span>;
                          const cost = calculateCost("blended", s.mtdIn, s.mtdOut);
                          return <span className="text-xs font-mono">${cost.toFixed(2)}</span>;
                        })()}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(() => {
                          const s = keyStats[key.friendlyName];
                          if (!s || !s.recentInv) return <span className="text-muted-foreground text-xs">—</span>;
                          // recentInv now holds lifetime data from the 90-day query
                          const cost = calculateCost("blended", s.recentIn, s.recentOut);
                          return <span className="text-xs font-mono">${cost.toFixed(2)}</span>;
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {(() => {
                          const s = keyStats[key.friendlyName];
                          if (!s?.lastUsed) return "Never";
                          const d = new Date(s.lastUsed + "Z");
                          const now = new Date();
                          const diffMs = now.getTime() - d.getTime();
                          const mins = Math.floor(diffMs / 60000);
                          if (mins < 1) return "Just now";
                          if (mins < 60) return `${mins}m ago`;
                          const hours = Math.floor(mins / 60);
                          if (hours < 24) return `${hours}h ago`;
                          const days = Math.floor(hours / 24);
                          if (days === 1) return "Yesterday";
                          if (days < 7) return `${days}d ago`;
                          return d.toLocaleDateString();
                        })()}
                      </TableCell>
                      <TableCell>
                        {(isAdmin || key.createdBy === session?.user?.email) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              setDeleteTarget({
                                userName: key.userName,
                                credentialId: key.credentialId,
                                friendlyName: key.friendlyName,
                              })
                            }
                            disabled={deleting === key.credentialId}
                          >
                            {deleting === key.credentialId
                              ? "Deleting..."
                              : "Delete"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {keyStats["__unattributed__"] && (() => {
                    const s = keyStats["__unattributed__"];
                    const mtdCost = s.mtdInv ? calculateCost("blended", s.mtdIn, s.mtdOut) : 0;
                    const lifetimeCost = s.recentInv ? calculateCost("blended", s.recentIn, s.recentOut) : 0;
                    if (!mtdCost && !lifetimeCost) return null;
                    return (
                      <TableRow className="text-muted-foreground/70 italic">
                        <TableCell className="whitespace-nowrap">Deleted keys</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right text-xs font-mono">
                          {mtdCost ? `$${mtdCost.toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {lifetimeCost ? `$${lifetimeCost.toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                      </TableRow>
                    );
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Configure how long an API key lasts. Use this key to make requests
              to the Amazon Bedrock API.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                API key name
              </label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-app-dev"
                pattern="^[a-zA-Z0-9_-]+$"
                required
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Alphanumeric characters, hyphens, and underscores only.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                API key expiration
              </label>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Set an expiration date to enhance security and limit exposure if
                the key is compromised.
              </p>
              <Select
                value={createExpiryPreset}
                onValueChange={handleExpiryChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_PRESETS.map((p) => (
                    <SelectItem key={p.days} value={String(p.days)}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {createExpiryPreset === "-1" && (
                <Input
                  type="number"
                  value={createCustomDays}
                  onChange={(e) => setCreateCustomDays(e.target.value)}
                  placeholder="Specify API key expiry in days"
                  min={1}
                  max={365}
                  className="mt-2"
                />
              )}
            </div>
            {createError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {createError}
              </div>
            )}
            <DialogFooter>
              <DialogClose className="inline-flex items-center justify-center rounded-lg h-8 px-3 text-sm font-medium border border-input bg-background hover:bg-muted transition-colors">
                Cancel
              </DialogClose>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete API key</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the key{" "}
              <strong>{deleteTarget?.friendlyName}</strong>? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className="inline-flex items-center justify-center rounded-lg h-8 px-3 text-sm font-medium border border-input bg-background hover:bg-muted transition-colors">
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteConfirm}
            >
              Delete key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

