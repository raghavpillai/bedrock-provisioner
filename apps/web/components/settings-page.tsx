"use client";

import { useState, useEffect } from "react";
import { client } from "@/lib/orpc";
import { useRegion } from "@/lib/region-context";
import type { Identity } from "@rockbed/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsPage() {
  const { region } = useRegion();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client.identity
      .whoAmI({ region })
      .then(setIdentity)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [region]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Account information and configuration.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AWS Identity</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-80" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : identity ? (
            <div className="rounded-md border">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-muted-foreground w-36 font-medium">
                      ARN
                    </TableCell>
                    <TableCell>
                      <code className="text-sm break-all">{identity.arn}</code>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium">
                      Account ID
                    </TableCell>
                    <TableCell>
                      <code className="text-sm">{identity.account}</code>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium">
                      User ID
                    </TableCell>
                    <TableCell>
                      <code className="text-sm">{identity.userId}</code>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium">
                      Region
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{region}</Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Failed to load identity. Check your AWS credentials.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
