"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { client } from "@/lib/orpc";
import { ALL_BEDROCK_REGIONS } from "@rockbed/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldIcon, LockIcon, AlertTriangleIcon, CheckCircleIcon } from "lucide-react";

type User = {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  createdAt: string;
};

export function AdminPage() {
  const { data: session, isPending } = useSession();
  const isAdmin = session?.user?.role === "admin";

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return <AdminGate />;
  }

  return <AdminDashboard />;
}

function AdminGate() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to verify");
    }
    setLoading(false);
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-card border border-border rounded-2xl p-8 w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-11 h-11 rounded-lg bg-aws-squid-ink flex items-center justify-center">
            <LockIcon className="size-5 text-white" />
          </div>
          <h2 className="text-lg font-semibold">Admin Access</h2>
          <p className="text-sm text-muted-foreground">
            Enter the admin password to access this page.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className="h-11 rounded-xl"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full h-11 rounded-xl" disabled={loading}>
            {loading ? "Verifying..." : "Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [allowedDomains, setAllowedDomains] = useState("");
  const [domainsInput, setDomainsInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [roleDialog, setRoleDialog] = useState<User | null>(null);
  const [selectedRole, setSelectedRole] = useState("user");
  const [enabledRegions, setEnabledRegions] = useState<Set<string>>(new Set(["us-east-1", "us-west-2"]));
  const [defaultRegion, setDefaultRegion] = useState("us-east-1");
  const [savingRegions, setSavingRegions] = useState(false);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [togglingLogging, setTogglingLogging] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [adminRes, settingsRes] = await Promise.all([
        fetch("/api/admin"),
        client.settings.get({ region: "us-east-1" }),
      ]);
      const data = await adminRes.json();
      setUsers(data.users ?? []);
      setAllowedDomains(data.allowedDomains ?? "");
      setDomainsInput(data.allowedDomains ?? "");
      setEnabledRegions(new Set(settingsRes.enabledRegions));
      setDefaultRegion(settingsRes.defaultRegion);
      setLoggingEnabled(settingsRes.invocationLoggingEnabled);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

  function validateDomains(input: string): string | null {
    if (!input.trim()) return null;
    const domains = input.split(",").map((d) => d.trim()).filter(Boolean);
    for (const d of domains) {
      if (!domainRegex.test(d)) return `"${d}" is not a valid domain`;
    }
    return null;
  }

  const domainError = validateDomains(domainsInput);

  async function saveDomains() {
    if (domainError) return;
    setSaving(true);
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_domains", domains: domainsInput }),
    });
    setAllowedDomains(domainsInput);
    setSaving(false);
  }

  async function toggleRegion(region: string) {
    const next = new Set(enabledRegions);
    if (next.has(region)) {
      next.delete(region);
      if (defaultRegion === region) {
        const first = [...next][0] ?? "us-east-1";
        setDefaultRegion(first);
        await client.settings.setRegion({ region: first });
      }
    } else {
      next.add(region);
    }
    setEnabledRegions(next);
    setSavingRegions(true);
    await client.settings.setEnabledRegions({ regions: [...next] });
    setSavingRegions(false);
  }

  async function changeDefaultRegion(region: string | null) {
    if (!region) return;
    setDefaultRegion(region);
    if (!enabledRegions.has(region)) {
      const next = new Set(enabledRegions);
      next.add(region);
      setEnabledRegions(next);
      await client.settings.setEnabledRegions({ regions: [...next] });
    }
    await client.settings.setRegion({ region });
  }

  async function setRole(userId: string, role: string) {
    await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_role", userId, role }),
    });
    setRoleDialog(null);
    refresh();
  }

  async function toggleInvocationLogging() {
    setTogglingLogging(true);
    try {
      await client.settings.enableInvocationLogging({
        region: defaultRegion,
        enable: !loggingEnabled,
      });
      setLoggingEnabled(!loggingEnabled);
    } catch {}
    setTogglingLogging(false);
  }

  // Only show saved domains as badges, not the live input
  const savedDomainsList = allowedDomains
    ? allowedDomains.split(",").map((d) => d.trim()).filter(Boolean)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldIcon className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Manage users, roles, and access controls.
          </p>
        </div>
      </div>

      {/* Invocation Logging */}
      {loggingEnabled ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="size-5 text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800">
                Model invocation logging is enabled
              </p>
              <p className="text-xs text-green-700 mt-0.5">
                Per-key usage statistics are being collected via CloudWatch Logs.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={toggleInvocationLogging}
            disabled={togglingLogging}
          >
            {togglingLogging ? "Disabling..." : "Disable"}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangleIcon className="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Model invocation logging is not enabled
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Enable logging to track per-key usage statistics. This creates
                an IAM role and CloudWatch log group automatically.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={toggleInvocationLogging}
            disabled={togglingLogging}
          >
            {togglingLogging ? "Enabling..." : "Enable logging"}
          </Button>
        </div>
      )}

      {/* Allowed Domains */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Allowed Email Domains</CardTitle>
          <p className="text-sm text-muted-foreground">
            Restrict sign-ups to specific email domains. Leave empty to allow
            all domains. Comma-separated.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              value={domainsInput}
              onChange={(e) => setDomainsInput(e.target.value)}
              placeholder="e.g. company.com, team.org"
              className="flex-1"
            />
            <Button
              onClick={saveDomains}
              disabled={saving || domainsInput === allowedDomains || !!domainError}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
          {domainError && domainsInput !== allowedDomains && (
            <p className="text-xs text-destructive mt-1.5">{domainError}</p>
          )}
          {savedDomainsList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {savedDomainsList.map((d) => (
                <Badge key={d} variant="secondary" className="gap-1 pr-1">
                  {d}
                  <button
                    onClick={() => {
                      const updated = savedDomainsList
                        .filter((x) => x !== d)
                        .join(", ");
                      setDomainsInput(updated);
                      // Auto-save the removal
                      setSaving(true);
                      fetch("/api/admin", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "set_domains", domains: updated }),
                      }).then(() => {
                        setAllowedDomains(updated);
                        setSaving(false);
                      });
                    }}
                    className="ml-0.5 rounded-full hover:bg-foreground/10 p-0.5"
                  >
                    <span className="text-[10px] leading-none">✕</span>
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Regions */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Regions</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enable or disable AWS regions. Only enabled regions are shown to
            users in the region selector.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Default region
            </label>
            <Select value={defaultRegion} onValueChange={changeDefaultRegion}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...enabledRegions].sort().map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border divide-y">
            {ALL_BEDROCK_REGIONS.map((r) => (
              <div
                key={r}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <code className="text-sm">{r}</code>
                  {r === defaultRegion && (
                    <Badge variant="default" className="text-[10px]">
                      Default
                    </Badge>
                  )}
                </div>
                <Button
                  variant={enabledRegions.has(r) ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs w-20"
                  disabled={savingRegions}
                  onClick={() => toggleRegion(r)}
                >
                  {enabledRegions.has(r) ? "Enabled" : "Disabled"}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Users */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">
            Users
            {!loading && (
              <span className="text-muted-foreground font-normal ml-2">
                ({users.length})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">
                            {user.name ?? "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            user.role === "admin" ? "default" : "secondary"
                          }
                          className="text-xs cursor-pointer"
                          onClick={() => {
                            setRoleDialog(user);
                            setSelectedRole(user.role ?? "user");
                          }}
                        >
                          {user.role ?? "user"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Role change dialog */}
      <Dialog
        open={!!roleDialog}
        onOpenChange={(open) => !open && setRoleDialog(null)}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update role for{" "}
              <strong>{roleDialog?.name ?? roleDialog?.email}</strong>
            </DialogDescription>
          </DialogHeader>
          <Select value={selectedRole} onValueChange={(v) => v && setSelectedRole(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <DialogClose className="inline-flex items-center justify-center rounded-lg h-8 px-3 text-sm font-medium border border-input bg-background hover:bg-muted transition-colors">
              Cancel
            </DialogClose>
            <Button
              size="sm"
              onClick={() => roleDialog && setRole(roleDialog.id, selectedRole)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
