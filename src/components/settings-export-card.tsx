import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { CsvExportButton } from "@/components/csv-export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCsvDate } from "@/lib/csv-export";
import type { ExportDatasetDescriptor, ExportScope } from "@/lib/export-registry";

const GROUP_LABELS: Record<ExportDatasetDescriptor["group"], string> = {
  operational: "Operational",
  governance: "Governance",
  configuration: "Configuration",
};

type SettingsExportCardProps = {
  dataset: ExportDatasetDescriptor;
  scope: ExportScope;
  count: number | null;
  loadingCount?: boolean;
};

export function SettingsExportCard({
  dataset,
  scope,
  count,
  loadingCount = false,
}: SettingsExportCardProps) {
  const countLabel = loadingCount
    ? "Counting records..."
    : count === null
      ? "Count unavailable"
      : `${count.toLocaleString()} records`;

  return (
    <Card className="h-full border-border/70 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{dataset.label}</CardTitle>
            <CardDescription>{dataset.description}</CardDescription>
          </div>
          <Badge variant="secondary">{GROUP_LABELS[dataset.group]}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{countLabel}</Badge>
          {dataset.routePath ? (
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2">
              <Link to={dataset.routePath}>
                Open source
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3 border-t pt-4">
        <div className="text-sm text-muted-foreground">
          Downloads a scoped CSV export for the current role.
        </div>
        <CsvExportButton
          label="Export CSV"
          filename={`${dataset.filenameStem}-${formatCsvDate()}.csv`}
          columns={dataset.columns}
          loadRows={() => dataset.loadRows(scope)}
        />
      </CardContent>
    </Card>
  );
}
