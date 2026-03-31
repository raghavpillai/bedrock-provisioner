"use client";

import { useState, useEffect, useCallback } from "react";
import { client } from "@/lib/orpc";
import { useRegion } from "@/lib/region-context";
import { useSession } from "@/lib/auth-client";
import { EXPIRY_PRESETS } from "@rockbed/shared";
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

export function KeyManager() {
  const { region } = useRegion();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [keys, setKeys] = useState<BedrockKey[]>([]);
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleExpiryChange(value: string) {
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
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {newKey && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-4 space-y-3">
            <p className="text-sm font-medium text-green-800">
              Key created successfully. Copy the API key now &mdash; it
              won&apos;t be shown again.
            </p>
            <div className="rounded-lg bg-background border p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">API key name</span>
                <code className="text-xs">{newKey.apiKeyId}</code>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground shrink-0">API key</span>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-xs font-mono truncate">
                    {newKey.apiKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs shrink-0"
                    onClick={() => navigator.clipboard.writeText(newKey.apiKey)}
                  >
                    Copy
                  </Button>
                </div>
              </div>
              {newKey.expiresAt && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Expires</span>
                  <span className="text-xs">
                    {new Date(newKey.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
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
            {isAdmin && <Button onClick={openCreateDialog}>Create key</Button>}
          </div>
        </CardHeader>
        <CardContent>
          {refreshing && keys.length === 0 ? (
            <TableRowsSkeleton cols={6} rows={3} />
          ) : keys.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No API keys yet.</p>
              {isAdmin && (
                <Button variant="outline" onClick={openCreateDialog}>
                  Create your first key
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>API key ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Created by</TableHead>
                    {isAdmin && <TableHead className="w-20" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.credentialId}>
                      <TableCell className="font-medium">
                        {key.friendlyName}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs text-muted-foreground">
                          {key.apiKeyId}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            key.status === "Active" ? "default" : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {key.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {key.expiresAt
                          ? new Date(key.expiresAt).toLocaleDateString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {key.createdBy ?? "—"}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
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
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
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
