import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buildCsv, downloadCsv, type CsvColumn } from "@/lib/csv-export";

type CsvExportButtonProps = {
  label?: string;
  filename: string;
  columns: CsvColumn[];
  loadRows: () => Promise<Array<Record<string, unknown>>>;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
};

export function CsvExportButton({
  label = "Export CSV",
  filename,
  columns,
  loadRows,
  disabled = false,
  variant = "outline",
}: CsvExportButtonProps) {
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await loadRows();
      downloadCsv(filename, buildCsv(columns, rows));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to export CSV");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant={variant} onClick={() => void exportCsv()} disabled={disabled || exporting}>
      {exporting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {exporting ? "Preparing export" : label}
    </Button>
  );
}
