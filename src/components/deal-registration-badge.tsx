import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  reviewDealRegistration,
  submitDealForRegistration,
} from "@/integrations/local/deal-commands";
import { toast } from "sonner";
import { CheckCircle2, FileCheck2, Loader2 } from "lucide-react";

export function DealRegistrationBadge({
  dealId,
  status,
  commercialApproved,
  canApprove = false,
  version,
  onUpdated,
}: {
  dealId: string;
  status: string;
  commercialApproved: boolean;
  canApprove?: boolean;
  version?: number;
  onUpdated: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await submitDealForRegistration({ dealId });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Deal submitted for registration");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit for registration");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (version == null) return;
    setLoading(true);
    try {
      const res = await reviewDealRegistration({
        dealId,
        expectedVersion: version,
        decision: "approved",
      });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Deal approved");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve deal");
    } finally {
      setLoading(false);
    }
  };

  const getBadgeTone = () => {
    if (commercialApproved) return "success" as const;
    if (status === "submitted") return "info" as const;
    return "neutral" as const;
  };

  const getLabel = () => {
    if (commercialApproved) return "Commercially Approved";
    if (status === "submitted") return "Registration Under Review";
    return "Draft Registration";
  };

  return (
    <div className="flex items-center gap-3">
      <Badge tone={getBadgeTone()}>{getLabel()}</Badge>

      {!commercialApproved && status !== "submitted" && (
        <Button variant="outline" size="sm" onClick={handleSubmit} disabled={loading}>
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <FileCheck2 className="w-4 h-4 mr-2" />
          )}
          Submit for Registration
        </Button>
      )}
      {canApprove && !commercialApproved ? (
        <Button variant="default" size="sm" onClick={handleApprove} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Approve deal
        </Button>
      ) : null}
    </div>
  );
}
