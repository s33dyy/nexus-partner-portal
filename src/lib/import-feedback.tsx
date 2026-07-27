import { FileSpreadsheet } from "lucide-react";

import type { ImportValidationError } from "@/lib/spreadsheet-import";

export function ImportFeedback(props: {
  successMessage?: string | null;
  errors?: ImportValidationError[];
}) {
  const errors = props.errors ?? [];

  return (
    <>
      {props.successMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {props.successMessage}
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <FileSpreadsheet className="h-4 w-4" />
            Import validation issues
          </div>
          <div className="mt-2 space-y-2 text-sm text-muted-foreground">
            {errors.slice(0, 6).map((error) => (
              <div key={`${error.rowNumber}-${error.messages.join("|")}`}>
                Row {error.rowNumber}: {error.messages.join(" • ")}
              </div>
            ))}
            {errors.length > 6 ? <div>+ {errors.length - 6} more row issues</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
