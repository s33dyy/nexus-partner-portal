import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Database, FolderOpen, Layers3, ShieldCheck } from "lucide-react";

import { SettingsExportCard } from "@/components/settings-export-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getRouteApi } from "@tanstack/react-router";
import { listVisibleExportDatasets, type ExportDatasetDescriptor, type ExportScope } from "@/lib/export-registry";

const routeApi = getRouteApi("/_authenticated/settings");

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

const SECTION_META: Record<
  ExportDatasetDescriptor["group"],
  {
    title: string;
    description: string;
    icon: typeof Database;
  }
> = {
  operational: {
    title: "Operational exports",
    description: "Current working data from deals, customers, notifications, documents, and rewards.",
    icon: Database,
  },
  governance: {
    title: "Governance exports",
    description: "Administrative records for users, partners, reviews, audit, team, and catalog data.",
    icon: ShieldCheck,
  },
  configuration: {
    title: "Configuration exports",
    description: "Shared dropdown values and approval settings that drive the portal experience.",
    icon: Layers3,
  },
};

function SettingsPage() {
  const { hasRole, profile } = useAuth();
  const role = hasRole("super_admin")
    ? "super_admin"
    : hasRole("partner_admin")
      ? "partner_admin"
      : "partner_user";

  const scope = useMemo<ExportScope>(
    () => ({
      role,
      isSuperAdmin: role === "super_admin",
      partnerId: profile?.partner_id ?? null,
      userId: profile?.id ?? null,
      companyName: profile?.company_name ?? null,
    }),
    [profile?.company_name, profile?.id, profile?.partner_id, role],
  );

  const visibleDatasets = useMemo(
    () =>
      listVisibleExportDatasets(role).sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
    [role],
  );

  const searchParams = routeApi.useSearch() as { zohoSignConnected?: string; zohoSignError?: string };

  useEffect(() => {
    if (searchParams.zohoSignConnected === "1") {
      toast.success("Zoho Sign connected successfully!");
      // Clean up URL
      window.history.replaceState(null, "", "/settings");
    } else if (searchParams.zohoSignError) {
      toast.error(`Zoho Sign connection failed: ${searchParams.zohoSignError}`);
      window.history.replaceState(null, "", "/settings");
    }
  }, [searchParams]);

  const groupedDatasets = useMemo(() => {
    const buckets: Record<ExportDatasetDescriptor["group"], ExportDatasetDescriptor[]> = {
      operational: [],
      governance: [],
      configuration: [],
    };

    for (const dataset of visibleDatasets) {
      buckets[dataset.group].push(dataset);
    }

    for (const datasets of Object.values(buckets)) {
      datasets.sort((left, right) => left.label.localeCompare(right.label));
    }

    return buckets;
  }, [visibleDatasets]);

  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [countsLoading, setCountsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadCounts = async () => {
      setCountsLoading(true);

      const results = await Promise.allSettled(
        visibleDatasets.map(async (dataset) => [dataset.id, await dataset.loadCount(scope)] as const),
      );

      if (!active) {
        return;
      }

      const nextCounts: Record<string, number | null> = {};
      for (const result of results) {
        if (result.status === "fulfilled") {
          const [datasetId, count] = result.value;
          nextCounts[datasetId] = count;
        }
      }

      for (const dataset of visibleDatasets) {
        if (!(dataset.id in nextCounts)) {
          nextCounts[dataset.id] = null;
        }
      }

      setCounts(nextCounts);
      setCountsLoading(false);
    };

    void loadCounts();

    return () => {
      active = false;
    };
  }, [scope, visibleDatasets]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5" />
            Settings data exports
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Export hub</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every dataset downloads as its own CSV. The cards below are role-aware, scoped to your
            account, and grouped by how the app uses the data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {role === "super_admin"
              ? "Super Admin"
              : role === "partner_admin"
                ? "Partner Admin"
                : "Partner User"}
          </Badge>
          {profile?.company_name ? <Badge variant="outline">{profile.company_name}</Badge> : null}
          <Badge variant="outline">{visibleDatasets.length} exportable datasets</Badge>
        </div>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="text-base">How this hub works</CardTitle>
          <CardDescription>
            Each card downloads one scoped CSV, so the export matches the data you are allowed to
            see.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 py-5 md:grid-cols-3">
          <InfoTile
            title="Separate downloads"
            description="Every dataset gets its own CSV file, so exports stay easy to find and share."
          />
          <InfoTile
            title="Scope-aware access"
            description="Hidden datasets stay hidden, and partner users only export their own records."
          />
          <InfoTile
            title="Source links"
            description="When a dataset has a source page, the card links straight back to it."
          />
        </CardContent>
      </Card>

      <Separator />

      <SectionBlock
        title={SECTION_META.operational.title}
        description={SECTION_META.operational.description}
        icon={SECTION_META.operational.icon}
        datasets={groupedDatasets.operational}
        scope={scope}
        counts={counts}
        countsLoading={countsLoading}
      />

      <SectionBlock
        title={SECTION_META.governance.title}
        description={SECTION_META.governance.description}
        icon={SECTION_META.governance.icon}
        datasets={groupedDatasets.governance}
        scope={scope}
        counts={counts}
        countsLoading={countsLoading}
      />

      <SectionBlock
        title={SECTION_META.configuration.title}
        description={SECTION_META.configuration.description}
        icon={SECTION_META.configuration.icon}
        datasets={groupedDatasets.configuration}
        scope={scope}
        counts={counts}
        countsLoading={countsLoading}
      />

      {role === "super_admin" && (
        <>
          <Separator />
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-lg">Integrations</CardTitle>
              </div>
              <CardDescription>
                Manage third-party integrations and platform connections.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl border bg-muted/20 p-4">
                <div>
                  <div className="font-medium">Zoho Sign</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Connect Zoho Sign to automatically send and track digital partner agreements.
                  </div>
                </div>
                <Button asChild>
                  <a href="/api/integrations/zoho-sign/connect">Connect Zoho Sign</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

type SectionBlockProps = {
  title: string;
  description: string;
  icon: typeof Database;
  datasets: ExportDatasetDescriptor[];
  scope: ExportScope;
  counts: Record<string, number | null>;
  countsLoading: boolean;
};

function SectionBlock({
  title,
  description,
  icon: Icon,
  datasets,
  scope,
  counts,
  countsLoading,
}: SectionBlockProps) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        {datasets.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
            No exportable datasets are visible in this section for your current role.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {datasets.map((dataset) => (
              <SettingsExportCard
                key={dataset.id}
                dataset={dataset}
                scope={scope}
                count={counts[dataset.id] ?? null}
                loadingCount={countsLoading}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoTile({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}
