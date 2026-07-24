import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Search, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerQuickCreateDialog } from "@/components/customer-quick-create-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { dealRegionLookupField } from "@/lib/deal-lookups";
import { formatDateLabel, toDateInputValue } from "@/lib/date-utils";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { awardDealWinPoints } from "@/lib/rewards";
import { DEAL_STAGE_ORDER, type DealRecord } from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";
import { recordAuditEvent } from "@/lib/workflow-events";

export const Route = createFileRoute("/_authenticated/admin/deals")({
  component: AdminDealsPage,
});

function AdminDealsPage() {
  const { profile, hasRole } = useAuth();
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reviewDraft, setReviewDraft] = useState<DealRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientCreateOpen, setClientCreateOpen] = useState(false);
  const [clientCreateSeed, setClientCreateSeed] = useState("");

  function uniqueStrings(values: Array<string | null | undefined>) {
    return [
      ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
    ];
  }

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_deals")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = ((data as DealRecord[] | null) ?? []).map((deal) => ({
        ...deal,
        possible_close_date: toDateInputValue(deal.possible_close_date),
        close_date: toDateInputValue(deal.close_date),
      }));
      setDeals(rows);
      setSource(rows.length > 0 ? "database" : "empty");
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch {
      setDeals([]);
      setSource("empty");
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    return deals.filter((deal) => {
      const matchesStatus =
        statusFilter === "all" || deal.status === statusFilter || deal.stage === statusFilter;
      const matchesQuery =
        !term ||
        [deal.account_name, deal.contact_name, deal.owner_name, deal.product, deal.notes]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesStatus && matchesQuery;
    });
  }, [deals, query, statusFilter]);

  const selectedDeal = useMemo(
    () => deals.find((deal) => deal.id === selectedId) ?? null,
    [deals, selectedId],
  );

  useEffect(() => {
    if (!selectedDeal) {
      setReviewDraft(null);
      setNote("");
      return;
    }
    setReviewDraft(selectedDeal);
    setNote(selectedDeal.notes);
  }, [selectedDeal]);

  const metrics = useMemo(() => {
    const queue = deals.filter((deal) => !["won", "lost"].includes(deal.stage)).length;
    const reviewed = deals.filter(
      (deal) => ["approved", "won", "lost"].includes(deal.status) || deal.status === "approved",
    ).length;
    return { queue, reviewed };
  }, [deals]);

  const statusOptions = useMemo(() => uniqueStrings(deals.map((deal) => deal.status)), [deals]);
  const stageOptions = useMemo(() => uniqueStrings(deals.map((deal) => deal.stage)), [deals]);
  const editOptions = useMemo(
    () => ({
      countries: uniqueStrings(deals.map((deal) => deal.country)),
      products: uniqueStrings(deals.map((deal) => deal.product)),
      sources: uniqueStrings(deals.map((deal) => deal.source)),
      budgets: uniqueStrings(deals.map((deal) => deal.customer_budget ?? "")),
    }),
    [deals],
  );
  const regionOptions = useMemo(
    () =>
      uniqueStrings(
        deals
          .filter((deal) => deal.country === (reviewDraft?.country ?? "India"))
          .map((deal) => deal.region),
      ),
    [deals, reviewDraft?.country],
  );

  const publishDealActivity = async (
    deal: DealRecord,
    type: string,
    notificationTitle: string,
    notificationMessage: string,
    feedTitle: string,
    feedCaption: string,
  ) => {
    const now = new Date().toISOString();
    await Promise.allSettled([
      supabase.from("notifications").insert({
        id: globalThis.crypto.randomUUID(),
        user_id: deal.user_id ?? null,
        partner_id: deal.partner_id ?? null,
        title: notificationTitle,
        message: notificationMessage,
        type,
        read: false,
        created_at: now,
      }),
      supabase.from("portal_news_posts").insert({
        id: globalThis.crypto.randomUUID(),
        title: feedTitle,
        caption: feedCaption,
        image_path: "",
        image_alt: "",
        posted_by_name: "LIVEY Admin",
        posted_by_role: "super_admin",
        is_seed: false,
        created_at: now,
        updated_at: now,
      }),
    ]);
  };

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Deal approvals" roleLabel="Super Admin" />;
  }

  const saveReview = async (
    status?: "approved" | "need_more_info" | "rejected" | "won" | "lost",
  ) => {
    if (!selectedDeal || !reviewDraft) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("portal_deals")
        .update({
          partner_id: reviewDraft.partner_id,
          customer_id: reviewDraft.customer_id,
          poc_profile_id: reviewDraft.poc_profile_id,
          account_name: reviewDraft.account_name,
          contact_name: reviewDraft.contact_name,
          owner_name: reviewDraft.owner_name,
          country: reviewDraft.country,
          region: reviewDraft.region,
          product: reviewDraft.product,
          quantity: Number(reviewDraft.quantity) || 1,
          amount: reviewDraft.amount,
          customer_budget: reviewDraft.customer_budget,
          probability: Number(reviewDraft.probability) || 0,
          possible_close_date: reviewDraft.possible_close_date || null,
          close_date:
            reviewDraft.close_date || reviewDraft.possible_close_date || selectedDeal.close_date,
          source: reviewDraft.source,
          notes: note.trim() || reviewDraft.notes,
          status: status ?? reviewDraft.status,
          stage:
            status === "approved"
              ? "approved"
              : status === "won"
                ? "won"
                : status === "lost"
                  ? "lost"
                  : reviewDraft.stage,
          last_touch: status ? `Admin set status to ${status}` : "Admin updated the deal",
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedDeal.id);
      if (error) throw error;
      if (status) {
        await publishDealActivity(
          selectedDeal,
          `deal_${status}`,
          `Deal ${status.replace("_", " ")}`,
          `${selectedDeal.account_name} was marked ${status.replace("_", " ")} by admin.`,
          `${selectedDeal.account_name} ${status.replace("_", " ")}`,
          `Super admin reviewed ${selectedDeal.product} and set the deal to ${status.replace("_", " ")}.`,
        );
        const reviewer = (await supabase.auth.getUser()).data.user;
        await recordAuditEvent(supabase, {
          actorName: reviewer?.email ?? "LIVEY Admin",
          actorRole: "super_admin",
          action: `deal_${status}`,
          targetType: "deal",
          targetName: selectedDeal.account_name,
          outcome: status,
          details: `Admin reviewed ${selectedDeal.product} and set status to ${status.replace("_", " ")}`,
          severity: status === "won" ? "medium" : "low",
        });
        if (status === "won") {
          try {
            await awardDealWinPoints(supabase, {
              dealId: selectedDeal.id,
              accountName: selectedDeal.account_name,
              product: selectedDeal.product,
              userId: selectedDeal.user_id,
              partnerId: selectedDeal.partner_id,
              actorId: (await supabase.auth.getUser()).data.user?.id ?? null,
            });
          } catch (rewardError) {
            console.error("Failed to record reward points for deal win", rewardError);
          }
        }
        toast.success(`Deal marked ${status.replace("_", " ")}`);
      } else {
        toast.success("Deal updated");
      }
      setNote("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update deal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Deal approvals</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review strategic opportunities, request more detail, and clear approved deals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "database" ? "Live Postgres data" : "Empty state"}
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Metric label="Queue" value={String(metrics.queue)} hint="Awaiting decision" />
        <Metric label="Reviewed" value={String(metrics.reviewed)} hint="Handled by admin" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.95fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Approval queue</CardTitle>
                <CardDescription>
                  Search, filter, and pick the deal you want to review.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search deals"
                    className="pl-8"
                  />
                </div>
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.dealStatus}
                  label="Status"
                  value={statusFilter === "all" ? "" : statusFilter}
                  onValueChange={(value) => setStatusFilter(value || "all")}
                  placeholder="All statuses"
                  clearLabel="All statuses"
                  allowClear
                  options={[...statusOptions, ...stageOptions]}
                  triggerClassName="w-44"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading approval queue...
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">No deals match this view.</div>
            ) : (
              <div className="divide-y">
                {filteredDeals.map((deal) => (
                  <button
                    key={deal.id}
                    onClick={() => {
                      setSelectedId(deal.id);
                      setNote(deal.notes);
                      setReviewOpen(true);
                    }}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/40 ${
                      selectedDeal?.id === deal.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{deal.account_name}</div>
                        <Badge variant="outline">{deal.status}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {deal.owner_name} · {deal.region} · {deal.stage}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{deal.amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {deal.probability}% probability
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent className="sm:max-w-4xl">
            <CardHeader className="border-b px-0 pb-4">
              <CardTitle className="text-base">Decision desk</CardTitle>
              <CardDescription>
                {selectedDeal
                  ? `Reviewing ${selectedDeal.account_name}`
                  : "Select a deal to review it."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-0 pt-6">
              {selectedDeal ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{selectedDeal.stage}</Badge>
                    <Badge variant="outline">{selectedDeal.status}</Badge>
                    <Badge variant="secondary">{selectedDeal.amount}</Badge>
                  </div>
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <Meta label="Contact" value={selectedDeal.contact_name} />
                    <Meta label="Owner" value={selectedDeal.owner_name} />
                    <Meta label="Product" value={selectedDeal.product} />
                    <Meta label="Close date" value={formatDateLabel(selectedDeal.close_date)} />
                  </div>
                  {reviewDraft ? (
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                      <div className="text-sm font-medium">Edit review details</div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Account</Label>
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealAccount}
                            source="account"
                            label="Account"
                            value={reviewDraft.account_name}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, account_name: value } : current,
                              )
                            }
                            onSelectionChange={(selection) =>
                              setReviewDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      partner_id: selection?.id ?? null,
                                      account_name: selection?.label ?? current.account_name,
                                    }
                                  : current,
                              )
                            }
                            placeholder="Select or create account"
                            allowCreate={false}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Client</Label>
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealContact}
                            source="client"
                            label="Client"
                            value={reviewDraft.contact_name}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, contact_name: value } : current,
                              )
                            }
                            onSelectionChange={(selection) =>
                              setReviewDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      customer_id: selection?.id ?? null,
                                      contact_name: selection?.label ?? current.contact_name,
                                    }
                                  : current,
                              )
                            }
                            onCreateRequest={(value) => {
                              setClientCreateSeed(value);
                              setClientCreateOpen(true);
                            }}
                            placeholder="Select or create client"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>POC</Label>
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealOwner}
                            source="poc"
                            label="POC"
                            value={reviewDraft.owner_name}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, owner_name: value } : current,
                              )
                            }
                            onSelectionChange={(selection) =>
                              setReviewDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      poc_profile_id: selection?.id ?? null,
                                      owner_name: selection?.label ?? current.owner_name,
                                    }
                                  : current,
                              )
                            }
                            placeholder="Select POC"
                            allowCreate={false}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Country</Label>
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealCountry}
                            label="Country"
                            value={reviewDraft.country}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, country: value, region: "" } : current,
                              )
                            }
                            placeholder="Select or create country"
                            options={editOptions.countries}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Region</Label>
                          <LookupCombobox
                            fieldName={dealRegionLookupField(reviewDraft.country)}
                            label="Region"
                            value={reviewDraft.region}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, region: value } : current,
                              )
                            }
                            placeholder="Select or create region"
                            options={regionOptions}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Product</Label>
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealProduct}
                            label="Product"
                            value={reviewDraft.product}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, product: value } : current,
                              )
                            }
                            placeholder="Select or create product"
                            options={editOptions.products}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Amount</Label>
                          <Input
                            value={reviewDraft.amount}
                            onChange={(e) =>
                              setReviewDraft((current) =>
                                current ? { ...current, amount: e.target.value } : current,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Customer budget</Label>
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealCustomerBudget}
                            label="Customer budget"
                            value={reviewDraft.customer_budget ?? ""}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, customer_budget: value } : current,
                              )
                            }
                            placeholder="Select or create budget"
                            options={editOptions.budgets}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Quantity</Label>
                          <Input
                            type="number"
                            min={1}
                            value={reviewDraft.quantity}
                            onChange={(e) =>
                              setReviewDraft((current) =>
                                current
                                  ? { ...current, quantity: Number(e.target.value) || 1 }
                                  : current,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Probability</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={reviewDraft.probability}
                            onChange={(e) =>
                              setReviewDraft((current) =>
                                current
                                  ? { ...current, probability: Number(e.target.value) || 0 }
                                  : current,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Possible close date</Label>
                          <Input
                            type="date"
                            value={reviewDraft.possible_close_date ?? ""}
                            onChange={(e) =>
                              setReviewDraft((current) =>
                                current
                                  ? { ...current, possible_close_date: e.target.value }
                                  : current,
                              )
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Source</Label>
                          <LookupCombobox
                            fieldName={LOOKUP_FIELDS.dealSource}
                            label="Source"
                            value={reviewDraft.source}
                            onValueChange={(value) =>
                              setReviewDraft((current) =>
                                current ? { ...current, source: value } : current,
                              )
                            }
                            placeholder="Select or create source"
                            options={editOptions.sources}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <Field label="Admin note">
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void saveReview()} disabled={saving}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Save changes
                    </Button>
                    <Button onClick={() => void saveReview("approved")} disabled={saving}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void saveReview("need_more_info")}
                      disabled={saving}
                    >
                      Request changes
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void saveReview("rejected")}
                      disabled={saving}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No deal selected.
                </div>
              )}
            </CardContent>
          </DialogContent>
        </Dialog>
      </div>

      <CustomerQuickCreateDialog
        open={clientCreateOpen}
        onOpenChange={setClientCreateOpen}
        initialCompanyName={clientCreateSeed}
        initialAccountOwner={profile?.full_name ?? reviewDraft?.owner_name ?? "LIVEY Admin"}
        initialRegion={
          reviewDraft?.country === "India"
            ? reviewDraft?.region || "India West"
            : reviewDraft?.region || "Global"
        }
        initialSegment="Mid-market"
        initialMrr="$0"
        initialStatus="active"
        initialNextStep="Intro call"
        initialLastTouch="New"
        userId={profile?.id ?? null}
        partnerId={reviewDraft?.partner_id ?? null}
        onCreated={(customer) =>
          setReviewDraft((current) =>
            current
              ? {
                  ...current,
                  customer_id: customer.id,
                  contact_name: customer.company_name,
                }
              : current,
          )
        }
      />
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
