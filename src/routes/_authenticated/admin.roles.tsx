import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Globe2, Loader2, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  countryNodeId,
  salesRegionNodeId,
} from "@/domain/contracts/governance";
import { ROLE_KEYS, type RoleKey } from "@/domain/contracts/taxonomy";
import { SALES_REGIONS, WORLD_COUNTRIES } from "@/domain/contracts/world-geography";
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

type RoleGeographyRow = { role_key: string; geography_node_id: string };

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
  const [geographyByRole, setGeographyByRole] = useState<Record<RoleKey, string[]>>(
    {} as Record<RoleKey, string[]>,
  );

  const load = async () => {
    setLoading(true);
    try {
      const [permissionsRes, geographyRes] = await Promise.all([
        supabase.from("role_permissions").select("*"),
        supabase.from("role_geography_access").select("*"),
      ]);
      if (permissionsRes.error) throw permissionsRes.error;
      if (geographyRes.error) throw geographyRes.error;

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

      const geography = {} as Record<RoleKey, string[]>;
      for (const role of ROLE_KEYS) geography[role] = [];
      for (const row of (geographyRes.data as RoleGeographyRow[] | null) ?? []) {
        const role = row.role_key as RoleKey;
        if (!geography[role]) continue;
        geography[role] = [...geography[role], row.geography_node_id];
      }

      setCapabilitiesByRole(capabilities);
      setGeographyByRole(geography);
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
  const draftGeography = useMemo(
    () => new Set(geographyByRole[selectedRole] ?? []),
    [geographyByRole, selectedRole],
  );
  const globalAccess = draftGeography.has(GOVERNANCE_GEOGRAPHY_NODE_IDS.global);

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

  const setGeography = (nodeIds: string[]) => {
    setGeographyByRole((current) => ({ ...current, [selectedRole]: nodeIds }));
  };

  const toggleGlobalAccess = (value: boolean) => {
    setGeography(value ? [GOVERNANCE_GEOGRAPHY_NODE_IDS.global] : []);
  };

  const toggleCountry = (nodeId: string, value: boolean) => {
    const next = new Set(draftGeography);
    next.delete(GOVERNANCE_GEOGRAPHY_NODE_IDS.global);
    if (value) next.add(nodeId);
    else next.delete(nodeId);
    setGeography(Array.from(next));
  };

  const toggleRegion = (regionKey: string, countries: string[], value: boolean) => {
    const next = new Set(draftGeography);
    next.delete(GOVERNANCE_GEOGRAPHY_NODE_IDS.global);
    for (const nodeId of countries) {
      if (value) next.add(nodeId);
      else next.delete(nodeId);
    }
    setGeography(Array.from(next));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveRolePermissions({
        roleKey: selectedRole,
        capabilities: draftCapabilities,
        geographyNodeIds: Array.from(draftGeography),
        globalAccess,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        result.affectedUserCount > 0
          ? `Saved. ${result.affectedUserCount} active user${result.affectedUserCount === 1 ? "" : "s"} on this role updated immediately.`
          : "Saved.",
      );
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
          Choose a role, set what it can Create/Read/Update/Delete per feature, and decide which
          regions it can access. Changes take effect immediately for every active user on that role.
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

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
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

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Region access</CardTitle>
            <CardDescription>
              Which countries {ROLE_KEY_LABELS[selectedRole]} can see and act on. Turning on Global
              Access ignores the region selection below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Globe2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Global access</span>
              </div>
              <Checkbox
                checked={globalAccess}
                onCheckedChange={(value) => toggleGlobalAccess(value === true)}
              />
            </div>

            <Accordion
              type="multiple"
              className={globalAccess ? "pointer-events-none opacity-50" : ""}
            >
              {SALES_REGIONS.map((region) => {
                const countries = WORLD_COUNTRIES.filter(
                  (country) => country.regionKey === region.key,
                );
                const countryNodeIds = countries.map((country) => countryNodeId(country.code));
                const checkedCount = countryNodeIds.filter((nodeId) =>
                  draftGeography.has(nodeId),
                ).length;
                const regionChecked =
                  checkedCount === countryNodeIds.length && countryNodeIds.length > 0;

                return (
                  <AccordionItem key={region.key} value={region.key}>
                    <div className="flex items-center gap-2 px-1">
                      <Checkbox
                        checked={regionChecked}
                        onCheckedChange={(value) =>
                          toggleRegion(region.key, countryNodeIds, value === true)
                        }
                        disabled={globalAccess}
                      />
                      <AccordionTrigger className="flex-1 py-2 text-sm">
                        <span className="flex items-center gap-2">
                          {region.name}
                          {checkedCount > 0 ? (
                            <Badge variant="secondary" className="text-xs">
                              {checkedCount}/{countryNodeIds.length}
                            </Badge>
                          ) : null}
                        </span>
                      </AccordionTrigger>
                    </div>
                    <AccordionContent>
                      <ScrollArea className="h-48 rounded-md border">
                        <div className="space-y-1 p-2">
                          {countries.map((country) => {
                            const nodeId = countryNodeId(country.code);
                            return (
                              <label
                                key={country.code}
                                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40"
                              >
                                <Checkbox
                                  checked={draftGeography.has(nodeId)}
                                  onCheckedChange={(value) => toggleCountry(nodeId, value === true)}
                                  disabled={globalAccess}
                                />
                                {country.name}
                              </label>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving || loading}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save {ROLE_KEY_LABELS[selectedRole]} permissions
        </Button>
      </div>
    </div>
  );
}
