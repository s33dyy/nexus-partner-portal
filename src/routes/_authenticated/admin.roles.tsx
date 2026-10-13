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
import {
  loadAccessControlSnapshot,
  removeUserAccessOverride,
  saveRolePermissions,
  saveUserAccessOverride,
} from "@/integrations/local/role-permission-commands";
import type { AccessControlSnapshot } from "@/server/rbac-policy.server";
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

type AccessSection = "roles" | "users";

export const Route = createFileRoute("/_authenticated/admin/roles")({
  component: AdminRolesPage,
});

function AdminRolesPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accessSection, setAccessSection] = useState<AccessSection>("roles");
  const [snapshot, setSnapshot] = useState<AccessControlSnapshot | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<RoleKey>("rm");
  const [capabilitiesByRole, setCapabilitiesByRole] = useState<Record<RoleKey, RoleCapabilities>>(
    {} as Record<RoleKey, RoleCapabilities>,
  );

  const load = async () => {
    setLoading(true);
    try {
      const loaded = await loadAccessControlSnapshot();
      setSnapshot(loaded);
      setCapabilitiesByRole(
        Object.fromEntries(loaded.roles.map((role) => [role.roleKey, role.capabilities])) as Record<
          RoleKey,
          RoleCapabilities
        >,
      );
      setSelectedUserId((current) => current || loaded.users[0]?.userId || "");
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
    if (selectedRole === "super_admin") return;
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

  const selectedUser = snapshot?.users.find((user) => user.userId === selectedUserId) ?? null;
  const selectedUserRole = selectedUser?.roleKey ?? null;
  const userRoleCapabilities = selectedUserRole
    ? (capabilitiesByRole[selectedUserRole] ?? emptyCapabilities())
    : emptyCapabilities();
  const overrideFor = (featureKey: FeatureKey, operation: CrudOperation) =>
    snapshot?.overrides.find(
      (override) =>
        override.userId === selectedUserId &&
        override.featureKey === featureKey &&
        override.operation === operation,
    );

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
          <Button
            onClick={() => void save()}
            disabled={saving || loading || selectedRole === "super_admin"}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {selectedRole === "super_admin"
              ? "Super Admin defaults are read-only"
              : `Save ${ROLE_KEY_LABELS[selectedRole]} permissions`}
          </Button>
        }
      />

      <div className="flex gap-2 border-b">
        <Button
          variant={accessSection === "roles" ? "secondary" : "ghost"}
          onClick={() => setAccessSection("roles")}
        >
          Role defaults
        </Button>
        <Button
          variant={accessSection === "users" ? "secondary" : "ghost"}
          onClick={() => setAccessSection("users")}
        >
          User access
        </Button>
      </div>

      {accessSection === "users" ? (
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="space-y-1">
              <CardTitle>Per-user access</CardTitle>
              <CardDescription>
                An explicit Allow or Deny overrides the selected user&apos;s role default. Inherited
                cells have no user override. Changes apply immediately on the next authorization
                check.
              </CardDescription>
            </div>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="w-80">
                <SelectValue placeholder="Select a user" />
              </SelectTrigger>
              <SelectContent>
                {(snapshot?.users ?? []).map((user) => (
                  <SelectItem key={user.userId} value={user.userId}>
                    {user.fullName || user.email} —{" "}
                    {user.roleKey ? ROLE_KEY_LABELS[user.roleKey] : "No role"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            {selectedUser ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    {CRUD_OPERATIONS.map((operation) => (
                      <TableHead key={operation} className="w-40 text-center">
                        {CRUD_LABELS[operation]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FEATURE_KEYS.map((feature) => (
                    <TableRow key={feature}>
                      <TableCell className="font-medium">{FEATURE_LABELS[feature]}</TableCell>
                      {CRUD_OPERATIONS.map((operation) => {
                        const override = overrideFor(feature, operation);
                        const value = override?.decision ?? "inherited";
                        return (
                          <TableCell key={operation} className="text-center">
                            <Select
                              value={value}
                              onValueChange={async (decision) => {
                                setSaving(true);
                                try {
                                  const result =
                                    decision === "inherited"
                                      ? await removeUserAccessOverride({
                                          userId: selectedUserId,
                                          featureKey: feature,
                                          operation,
                                        })
                                      : await saveUserAccessOverride({
                                          userId: selectedUserId,
                                          featureKey: feature,
                                          operation,
                                          decision: decision as "allow" | "deny",
                                        });
                                  if (!result.ok) toast.error(result.message);
                                  else await load();
                                } finally {
                                  setSaving(false);
                                }
                              }}
                              disabled={saving || !selectedUserRole}
                            >
                              <SelectTrigger
                                aria-label={`${CRUD_LABELS[operation]} ${FEATURE_LABELS[feature]}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="inherited">
                                  Inherited (
                                  {userRoleCapabilities[feature]?.[operation]
                                    ? "Allowed"
                                    : "Denied"}
                                  )
                                </SelectItem>
                                <SelectItem value="allow">Explicit allow</SelectItem>
                                <SelectItem value="deny">Explicit deny</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">No users available.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {accessSection === "roles" ? (
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="space-y-1">
              <CardTitle>Feature access</CardTitle>
              <CardDescription>
                Create, Read, Update, and Delete permission per feature for{" "}
                {ROLE_KEY_LABELS[selectedRole]}.{" "}
                {selectedRole === "super_admin"
                  ? "Super Admin has structural full access and cannot be edited."
                  : ""}
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
                          disabled={selectedRole === "super_admin"}
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
      ) : null}
    </div>
  );
}
