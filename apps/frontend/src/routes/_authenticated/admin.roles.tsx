import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";

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
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <ShieldQuestion className="h-3.5 w-3.5" />
          Administration
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Role permissions</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Choose a role and set what it can Create/Read/Update/Delete per feature. Changes take
          effect immediately for every active user on that role. Region access is set per user — see
          a user's own record in Users &amp; roles.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Label htmlFor="role-select" className="text-sm">
          Selected role
        </Label>
        <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as RoleKey)}>
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
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Feature access</CardTitle>
          <CardDescription>
            Create, Read, Update, and Delete permission per feature for{" "}
            {ROLE_KEY_LABELS[selectedRole]}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left">
                  <th className="px-4 py-2 font-medium">Feature</th>
                  {CRUD_OPERATIONS.map((operation) => (
                    <th key={operation} className="px-4 py-2 text-center font-medium">
                      {CRUD_LABELS[operation]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_KEYS.map((feature) => (
                  <tr key={feature} className="border-b last:border-0">
                    <td className="px-4 py-2.5">{FEATURE_LABELS[feature]}</td>
                    {CRUD_OPERATIONS.map((operation) => (
                      <td key={operation} className="px-4 py-2.5 text-center">
                        <Checkbox
                          checked={draftCapabilities[feature]?.[operation] ?? false}
                          onCheckedChange={(value) =>
                            setCapability(feature, operation, value === true)
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving || loading}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save {ROLE_KEY_LABELS[selectedRole]} permissions
        </Button>
      </div>
    </div>
  );
}
