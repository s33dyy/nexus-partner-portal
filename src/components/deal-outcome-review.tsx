import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  submitPO,
  approvePO,
  requestChanges,
  rejectOutcome,
} from "@/integrations/local/outcome-review-commands";
import { toast } from "sonner";
import { FileUp, Check, X, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePartnerAccess } from "@/hooks/use-partner-access";

export function DealOutcomeReview({
  dealId,
  dealStage,
  commercialApproved,
}: {
  dealId: string;
  dealStage: string;
  commercialApproved: boolean;
}) {
  const { can } = useAuth();
  const access = usePartnerAccess();
  const isSuperAdmin = access.isLiveyInternal; // Replaced super_admin with livey internal for deal approvals.
  const [loading, setLoading] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [poAmount, setPoAmount] = useState("");
  const [poUrl, setPoUrl] = useState("");

  const isNegotiation = dealStage === "negotiation";
  const isWon = dealStage === "won";

  if (!commercialApproved && !isWon) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> Outcome Review Locked
          </CardTitle>
          <CardDescription>
            Deal must be commercially approved and in negotiation before submitting a PO.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const handleSubmit = async () => {
    if (!poNumber || !poAmount || !poUrl) return toast.error("Please fill in all PO details");
    setLoading(true);
    try {
      const res = await submitPO({
        dealId,
        poNumber,
        poAmount: parseFloat(poAmount),
        poDocumentUrl: poUrl,
        poDate: new Date().toISOString().split("T")[0],
        currencyCode: "USD",
      });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("PO submitted for review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit PO");
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: "approve" | "changes" | "reject") => {
    setLoading(true);
    try {
      const reason = "Admin action"; // MVP static reason
      let res;
      if (action === "approve") res = await approvePO({ dealId, reason });
      else if (action === "changes") res = await requestChanges({ dealId, reason });
      else res = await rejectOutcome({ dealId, reason });

      if (!res.ok) throw new Error(res.failure.message);
      toast.success(`Outcome ${action} successful`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update outcome review");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>PO & Outcome Review</CardTitle>
        <CardDescription>
          Submit and review purchase orders to mark this deal as Won.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isNegotiation && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">PO Number</label>
                <Input
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="e.g. PO-12345"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">PO Amount (USD)</label>
                <Input
                  type="number"
                  value={poAmount}
                  onChange={(e) => setPoAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">PO Document URL</label>
              <Input
                value={poUrl}
                onChange={(e) => setPoUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <Button onClick={handleSubmit} disabled={loading} className="w-full">
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileUp className="w-4 h-4 mr-2" />
              )}
              Submit PO
            </Button>
          </div>
        )}

        {isSuperAdmin && (
          <div className="p-4 bg-muted rounded-md space-y-4 border">
            <h4 className="font-medium text-sm">Super Admin Actions</h4>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => handleAction("approve")}
                disabled={loading}
              >
                <Check className="w-4 h-4 mr-2" /> Approve & Win Deal
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleAction("changes")}
                disabled={loading}
              >
                Request Changes
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleAction("reject")}
                disabled={loading}
              >
                <X className="w-4 h-4 mr-2" /> Reject & Lose Deal
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
