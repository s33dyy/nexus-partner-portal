import { useEffect, useMemo, useState, type ReactNode } from "react";

import { createDropdownCustomer } from "@/integrations/local/dropdown-sources";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerRecord } from "@/lib/portal-records";
import { toast } from "sonner";

type CustomerQuickCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCompanyName?: string;
  initialAccountOwner?: string;
  initialRegion?: string;
  initialSegment?: string;
  initialMrr?: string;
  initialRenewalDate?: string;
  initialStatus?: string;
  initialNextStep?: string;
  initialLastTouch?: string;
  initialHealthScore?: number;
  userId?: string | null;
  partnerId?: string | null;
  onCreated?: (customer: CustomerRecord) => void;
};

type Draft = {
  company_name: string;
  account_owner: string;
  region: string;
  segment: string;
  health_score: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch: string;
};

function defaultRenewalDate() {
  const nextYear = new Date();
  nextYear.setDate(nextYear.getDate() + 365);
  return nextYear.toISOString().slice(0, 10);
}

export function CustomerQuickCreateDialog({
  open,
  onOpenChange,
  initialCompanyName = "",
  initialAccountOwner = "",
  initialRegion = "India West",
  initialSegment = "Mid-market",
  initialMrr = "$0",
  initialRenewalDate = defaultRenewalDate(),
  initialStatus = "active",
  initialNextStep = "Intro call",
  initialLastTouch = "New",
  initialHealthScore = 50,
  userId,
  partnerId,
  onCreated,
}: CustomerQuickCreateDialogProps) {
  const [draft, setDraft] = useState<Draft>({
    company_name: initialCompanyName,
    account_owner: initialAccountOwner,
    region: initialRegion,
    segment: initialSegment,
    health_score: initialHealthScore,
    mrr: initialMrr,
    renewal_date: initialRenewalDate,
    status: initialStatus,
    next_step: initialNextStep,
    last_touch: initialLastTouch,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft({
      company_name: initialCompanyName,
      account_owner: initialAccountOwner,
      region: initialRegion,
      segment: initialSegment,
      health_score: initialHealthScore,
      mrr: initialMrr,
      renewal_date: initialRenewalDate,
      status: initialStatus,
      next_step: initialNextStep,
      last_touch: initialLastTouch,
    });
  }, [
    open,
    initialAccountOwner,
    initialCompanyName,
    initialHealthScore,
    initialLastTouch,
    initialMrr,
    initialNextStep,
    initialRegion,
    initialRenewalDate,
    initialSegment,
    initialStatus,
  ]);

  const companyLabel = useMemo(() => draft.company_name.trim(), [draft.company_name]);

  const createCustomer = async () => {
    if (!draft.company_name.trim()) {
      toast.error("Company name is required");
      return;
    }
    if (!draft.account_owner.trim()) {
      toast.error("Account owner is required");
      return;
    }
    if (!draft.renewal_date) {
      toast.error("Renewal date is required");
      return;
    }

    setSaving(true);
    try {
      const created = await createDropdownCustomer({
        company_name: draft.company_name,
        account_owner: draft.account_owner,
        region: draft.region,
        segment: draft.segment,
        health_score: Number(draft.health_score) || 0,
        mrr: draft.mrr,
        renewal_date: draft.renewal_date,
        status: draft.status,
        next_step: draft.next_step,
        last_touch: draft.last_touch,
        user_id: userId ?? null,
        partner_id: partnerId ?? null,
      });
      toast.success("Client created");
      onCreated?.(created);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create client</DialogTitle>
          <DialogDescription>
            Save a real customer record so the client dropdown and Customers tab stay linked.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Company name *">
            <Input
              value={draft.company_name}
              onChange={(e) => setDraft((current) => ({ ...current, company_name: e.target.value }))}
              placeholder={companyLabel || "Acme Partners"}
            />
          </Field>
          <Field label="Account owner *">
            <Input
              value={draft.account_owner}
              onChange={(e) => setDraft((current) => ({ ...current, account_owner: e.target.value }))}
              placeholder="Owner name"
            />
          </Field>
          <Field label="Region *">
            <Input
              value={draft.region}
              onChange={(e) => setDraft((current) => ({ ...current, region: e.target.value }))}
              placeholder="India West"
            />
          </Field>
          <Field label="Segment *">
            <Input
              value={draft.segment}
              onChange={(e) => setDraft((current) => ({ ...current, segment: e.target.value }))}
              placeholder="Mid-market"
            />
          </Field>
          <Field label="MRR *">
            <Input
              value={draft.mrr}
              onChange={(e) => setDraft((current) => ({ ...current, mrr: e.target.value }))}
              placeholder="$0"
            />
          </Field>
          <Field label="Renewal date *">
            <Input
              type="date"
              value={draft.renewal_date}
              onChange={(e) =>
                setDraft((current) => ({ ...current, renewal_date: e.target.value }))
              }
            />
          </Field>
          <Field label="Status *">
            <Input
              value={draft.status}
              onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value }))}
              placeholder="active"
            />
          </Field>
          <Field label="Health score">
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.health_score}
              onChange={(e) =>
                setDraft((current) => ({ ...current, health_score: Number(e.target.value) || 0 }))
              }
            />
          </Field>
        </div>

        <Field label="Next step *">
          <Textarea
            value={draft.next_step}
            onChange={(e) => setDraft((current) => ({ ...current, next_step: e.target.value }))}
            rows={3}
          />
        </Field>

        <Field label="Last touch">
          <Input
            value={draft.last_touch}
            onChange={(e) => setDraft((current) => ({ ...current, last_touch: e.target.value }))}
            placeholder="New"
          />
        </Field>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void createCustomer()} disabled={saving}>
            {saving ? "Creating..." : "Create client"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
