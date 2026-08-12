import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, Toolbar } from "@/components/page-header";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  FEATURE_KEYS,
  FEATURE_LABELS,
  ROLE_KEY_LABELS,
  type CrudOperation,
  type FeatureKey,
} from "@/domain/contracts/features";
import { ROLE_KEYS, type RoleKey } from "@/domain/contracts/taxonomy";
import { saveRolePermissions } from "@/integrations/local/role-permission-commands";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";

const CRUD_OPERATIONS: CrudOperation[] = ["create", "read", "update", "delete"];
const CRUD_LABELS: Record<CrudOperation, string> = {
  create: "Create",
  read: "Read",
  update: "Update",
  delete: "Delete",
};

type RoleCapabilities = Record<FeatureKey, Record<CrudOperation, boolean>>;

function emptyCapabilities(): RoleCapabilities {
  const capabilities = {} as RoleCapabilities;
  for (const feature of FEATURE_KEYS) {
    capabilities[feature] = { create: false, read: false, update: false, delete: false };
  }
  return capabilities;
}

type RolePermissionRow = {
  role_key: string;
  feature_key: string;
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
};

export const Route = createFileRoute("/_authenticated/admin/roles")({
  component: AdminRolesPage,
});

function AdminRolesPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleKey>("rm");
  const [capabilitiesByRole, setCapabilitiesByRole] = useState<Record<RoleKey, RoleCapabilities>>(
    {} as Record<RoleKey, RoleCapabilities>,
  );

  const load = async () => {
    setLoading(true);
    try {
      const permissionsRes = await supabase.from("role_permissions").select("*");
      if (permissionsRes.error) throw permissionsRes.error;

      const capabilities = {} as Record<RoleKey, RoleCapabilities>;
      for (const role of ROLE_KEYS) capabilities[role] = emptyCapabilities();
      for (const row of (permissionsRes.data as RolePermissionRow[] | null) ?? []) {
        const role = row.role_key as RoleKey;
        const feature = row.feature_key as FeatureKey;
        if (!capabilities[role] || !(feature in capabilities[role])) continue;
        capabilities[role][feature] = {
          create: row.can_create,
          read: row.can_read,
          update: row.can_update,
          delete: row.can_delete,
        };
      }

      setCapabilitiesByRole(capabilities);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load role permissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const draftCapabilities = capabilitiesByRole[selectedRole] ?? emptyCapabilities();

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Role permissions" roleLabel="Super Admin" />;
  }

  const setCapability = (feature: FeatureKey, operation: CrudOperation, value: boolean) => {
    setCapabilitiesByRole((current) => ({
      ...current,
      [selectedRole]: {
        ...(current[selectedRole] ?? emptyCapabilities()),
        [feature]: { ...(current[selectedRole]?.[feature] ?? {}), [operation]: value },
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveRolePermissions({
        roleKey: selectedRole,
        capabilities: draftCapabilities,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Saved.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save role permissions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        icon={<ShieldQuestion className="h-3.5 w-3.5" />}
        title="Role permissions"
        description={
          <>
            Choose a role and set what it can Create/Read/Update/Delete per feature. Changes take
            effect immediately for every active user on that role. Region access is set per user —
            see a user's own record in Users &amp; roles.
          </>
        }
        actions={
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save {ROLE_KEY_LABELS[selectedRole]} permissions
          </Button>
        }
      />

      <Card>
        <CardHeader className="space-y-4 border-b">
          <div className="space-y-1">
            <CardTitle>Feature access</CardTitle>
            <CardDescription>
              Create, Read, Update, and Delete permission per feature for{" "}
              {ROLE_KEY_LABELS[selectedRole]}.
            </CardDescription>
          </div>
          <Toolbar>
            <Label htmlFor="role-select" className="text-xs font-medium">
              Selected role
            </Label>
            <Select
              value={selectedRole}
              onValueChange={(value) => setSelectedRole(value as RoleKey)}
            >
              <SelectTrigger id="role-select" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_KEYS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_KEY_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </Toolbar>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                {CRUD_OPERATIONS.map((operation) => (
                  <TableHead key={operation} className="w-24 text-center">
                    {CRUD_LABELS[operation]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {FEATURE_KEYS.map((feature) => (
                <TableRow key={feature}>
                  <TableCell className="font-medium">{FEATURE_LABELS[feature]}</TableCell>
                  {CRUD_OPERATIONS.map((operation) => (
                    <TableCell key={operation} className="text-center">
                      <Checkbox
                        className="mx-auto"
                        aria-label={`${CRUD_LABELS[operation]} ${FEATURE_LABELS[feature]}`}
                        checked={draftCapabilities[feature]?.[operation] ?? false}
                        onCheckedChange={(value) =>
                          setCapability(feature, operation, value === true)
                        }
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
