import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Headset, Inbox, Loader2, MessageSquare, Plus, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader, Toolbar } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGrid, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { supabase } from "@/integrations/local/client";
import {
  acceptTicket,
  addTicketReply,
  closeTicket,
  createTicket as createTicketCommand,
  decideReopen,
  markTicketWaitingOnPartner,
  requestReopen,
} from "@/integrations/local/ticket-commands";
import { formatDateTimeLabel } from "@/lib/date-utils";
import { applyPartnerScope, hasSupportScopeBypass } from "@/lib/partner-scope";
import { type SupportTicketCommentRecord, type SupportTicketRecord } from "@/lib/portal-records";
import { canManageTicket } from "@/lib/ticket-permissions";

export const Route = createFileRoute("/_authenticated/support")({
  component: SupportPage,
});

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "info" | "danger";

const STATUS_TONE: Record<string, BadgeTone> = {
  open: "info",
  in_progress: "brand",
  waiting_on_partner: "warning",
  reopen_requested: "warning",
  closed: "neutral",
};

const PRIORITY_TONE: Record<string, BadgeTone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

function SupportPage() {
  const { profile, hasRole, roleKey, assignment } = useAuth();
  useRequireAccess("partial");

  const canManageSelectedTicket = canManageTicket(roleKey);

  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [comments, setComments] = useState<SupportTicketCommentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [savingReply, setSavingReply] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [ticketDraft, setTicketDraft] = useState({
    subject: "",
    description: "",
    priority: "medium",
    productSku: "",
    serialNumber: "",
  });
  const [metaDraft, setMetaDraft] = useState({
    status: "open",
    priority: "medium",
    assignee_name: "",
  });
  const [replyIsInternal, setReplyIsInternal] = useState(false);

  const loadTickets = async () => {
    setLoading(true);
    try {
      let ticketQuery = supabase
        .from("support_tickets")
        .select("*")
        .order("updated_at", { ascending: false });

      ticketQuery = applyPartnerScope(ticketQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
        fallbackColumn: "created_by",
        bypassOwnershipFilter: hasSupportScopeBypass(roleKey, assignment?.geographyCeilingNodeId),
      });

      const { data, error } = await ticketQuery;
      if (error) throw error;
      const rows = (data as SupportTicketRecord[] | null) ?? [];
      setTickets(rows);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load tickets");
      setTickets([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadTickets();
  }, [hasRole, profile?.id, profile?.partner_id, roleKey, assignment?.geographyCeilingNodeId]);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [selectedId, tickets],
  );

  useEffect(() => {
    if (!selectedTicket) {
      setComments([]);
      return;
    }

    setMetaDraft({
      status: selectedTicket.status,
      priority: selectedTicket.priority,
      assignee_name: selectedTicket.assignee_name ?? "",
    });

    void (async () => {
      const { data, error } = await supabase
        .from("support_ticket_comments")
        .select("*")
        .eq("ticket_id", selectedTicket.id)
        .order("created_at", { ascending: true });

      if (error) {
        toast.error(error.message);
        setComments([]);
        return;
      }

      // Filter out internal comments if the user is a partner
      const allComments = (data as SupportTicketCommentRecord[] | null) ?? [];
      const isSupportUser = hasRole("super_admin") || hasRole("livey_support");
      setComments(isSupportUser ? allComments : allComments.filter((c) => !c.is_internal));
    })();
  }, [selectedTicket, hasRole]);

  const filteredTickets = useMemo(() => {
    const term = query.trim().toLowerCase();
    return tickets.filter((ticket) =>
      !term
        ? true
        : [ticket.subject, ticket.description, ticket.status, ticket.priority]
            .join(" ")
            .toLowerCase()
            .includes(term),
    );
  }, [query, tickets]);

  const createTicket = async () => {
    if (!ticketDraft.subject.trim() || !ticketDraft.description.trim()) {
      toast.error("Subject and description are required");
      return;
    }

    setCreating(true);
    try {
      const result = await createTicketCommand({
        subject: ticketDraft.subject,
        description: ticketDraft.description,
        priority: ticketDraft.priority,
        productSku: ticketDraft.productSku || null,
        serialNumber: ticketDraft.serialNumber || null,
        partnerId: profile?.partner_id ?? null,
        creatorName: profile?.full_name ?? "LIVEY User",
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }

      setTicketDraft({
        subject: "",
        description: "",
        priority: "medium",
        productSku: "",
        serialNumber: "",
      });
      toast.success("Support ticket created");
      setCreateOpen(false);
      await loadTickets();
      setSelectedId(result.subjectId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create ticket");
    } finally {
      setCreating(false);
    }
  };

  const applyTicketAction = async (
    action: () => Promise<{ ok: boolean; failure?: { message: string } }>,
    successMessage: string,
  ) => {
    if (!selectedTicket) return;
    setSavingMeta(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(result.failure?.message ?? "That action failed");
        return;
      }
      toast.success(successMessage);
      await loadTickets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update ticket");
    } finally {
      setSavingMeta(false);
    }
  };

  const saveTicketPriority = async () => {
    if (!selectedTicket || !hasRole("super_admin")) return;
    setSavingMeta(true);
    try {
      const { error } = await supabase
        .from("support_tickets")
        .update({
          priority: metaDraft.priority,
          assignee_name: metaDraft.assignee_name.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedTicket.id);
      if (error) throw error;
      toast.success("Ticket updated");
      await loadTickets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update ticket");
    } finally {
      setSavingMeta(false);
    }
  };

  const addReply = async () => {
    if (!selectedTicket) return;
    if (!replyDraft.trim()) {
      toast.error("Write a reply before sending");
      return;
    }

    setSavingReply(true);
    try {
      const result = await addTicketReply({
        ticketId: selectedTicket.id,
        body: replyDraft,
        isInternal: replyIsInternal,
        authorName: profile?.full_name ?? "LIVEY User",
        authorRole: hasRole("super_admin")
          ? "super_admin"
          : hasRole("partner_admin")
            ? "partner_admin"
            : "partner_user",
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }

      setReplyDraft("");
      if (replyIsInternal) setReplyIsInternal(false);
      toast.success("Reply added");
      await loadTickets();
      const commentRes = await supabase
        .from("support_ticket_comments")
        .select("*")
        .eq("ticket_id", selectedTicket.id)
        .order("created_at", { ascending: true });

      const allComments = (commentRes.data as SupportTicketCommentRecord[] | null) ?? [];
      const isSupportUser = hasRole("super_admin") || hasRole("livey_support");
      setComments(isSupportUser ? allComments : allComments.filter((c) => !c.is_internal));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add reply");
    } finally {
      setSavingReply(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Support"
        icon={<Headset className="h-3.5 w-3.5" />}
        title="Portal tickets"
        description="Create support requests, track replies, and keep conversations inside the portal."
        actions={
          <>
            <Badge tone="neutral">
              {hasRole("super_admin") ? "All tickets" : "Partner-scoped"}
            </Badge>
            <Button
              variant="outline"
              onClick={() => {
                setRefreshing(true);
                void loadTickets();
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
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New ticket
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Tickets</CardTitle>
              <CardDescription>Open any ticket to view the full thread.</CardDescription>
              <Toolbar className="pt-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tickets"
                  className="w-full max-w-xs"
                />
              </Toolbar>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading tickets...
                </div>
              ) : filteredTickets.length === 0 ? (
                <EmptyState
                  icon={<Headset className="h-5 w-5" />}
                  title="No tickets found for this view"
                  description={
                    query.trim()
                      ? "Nothing matches that search. Clear it to see the full list."
                      : "Raise a ticket and the whole conversation stays inside the portal."
                  }
                  action={
                    query.trim() ? null : (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" /> New ticket
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="divide-y">
                  {filteredTickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => setSelectedId(ticket.id)}
                      className={`w-full px-5 py-4 text-left transition hover:bg-muted/30 ${
                        ticket.id === selectedId ? "bg-muted/30" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            <span className="mr-2 text-muted-foreground">{ticket.human_id}</span>
                            {ticket.subject}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {ticket.created_by_name} · {formatDateTimeLabel(ticket.updated_at)}
                          </div>
                          {ticket.status !== "closed" && ticket.resolve_due_at && (
                            <div
                              className={`mt-1 text-xs ${new Date(ticket.resolve_due_at) < new Date() ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                            >
                              SLA Resolve: {formatDateTimeLabel(ticket.resolve_due_at)}
                              {new Date(ticket.resolve_due_at) < new Date() && " (Breached)"}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge tone={PRIORITY_TONE[ticket.priority] ?? "neutral"}>
                            {ticket.priority}
                          </Badge>
                          <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"}>
                            {ticket.status}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              {selectedTicket && (
                <span className="text-muted-foreground">{selectedTicket.human_id}</span>
              )}
              {selectedTicket?.subject ?? "Ticket detail"}
            </CardTitle>
            <CardDescription>
              {selectedTicket
                ? "Review the current status and continue the conversation below."
                : "Select a ticket to view its thread."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {!selectedTicket ? (
              <EmptyState
                icon={<Inbox className="h-5 w-5" />}
                title="No ticket selected yet"
                description="Pick a ticket from the list to read its thread and reply."
              />
            ) : (
              <>
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[selectedTicket.priority] ?? "neutral"}>
                      {selectedTicket.priority}
                    </Badge>
                    <Badge tone={STATUS_TONE[selectedTicket.status] ?? "neutral"}>
                      {selectedTicket.status}
                    </Badge>
                    {selectedTicket.assignee_name ? (
                      <Badge tone="neutral">Assigned to {selectedTicket.assignee_name}</Badge>
                    ) : null}
                    {selectedTicket.status !== "closed" && selectedTicket.resolve_due_at && (
                      <Badge
                        tone={
                          new Date(selectedTicket.resolve_due_at) < new Date()
                            ? "danger"
                            : "warning"
                        }
                      >
                        {new Date(selectedTicket.resolve_due_at) < new Date()
                          ? "SLA Breached"
                          : `Due: ${formatDateTimeLabel(selectedTicket.resolve_due_at)}`}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 text-sm">{selectedTicket.description}</div>
                  {(selectedTicket.product_sku || selectedTicket.serial_number) && (
                    <div className="mt-4 flex flex-wrap gap-4 rounded-md border bg-card p-3 text-xs">
                      {selectedTicket.product_sku && (
                        <div>
                          <span className="font-semibold text-muted-foreground">Product SKU:</span>{" "}
                          {selectedTicket.product_sku}
                        </div>
                      )}
                      {selectedTicket.serial_number && (
                        <div>
                          <span className="font-semibold text-muted-foreground">Serial:</span>{" "}
                          {selectedTicket.serial_number}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {canManageSelectedTicket ? (
                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="flex flex-wrap gap-2">
                      {selectedTicket.status === "open" && (
                        <Button
                          size="sm"
                          disabled={savingMeta}
                          onClick={() =>
                            void applyTicketAction(
                              () => acceptTicket({ ticketId: selectedTicket.id }),
                              "Ticket accepted",
                            )
                          }
                        >
                          Accept
                        </Button>
                      )}
                      {selectedTicket.status === "in_progress" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingMeta}
                          onClick={() =>
                            void applyTicketAction(
                              () => markTicketWaitingOnPartner({ ticketId: selectedTicket.id }),
                              "Marked waiting on partner",
                            )
                          }
                        >
                          Wait on partner
                        </Button>
                      )}
                      {(selectedTicket.status === "open" ||
                        selectedTicket.status === "in_progress" ||
                        selectedTicket.status === "waiting_on_partner") && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={savingMeta}
                          onClick={() =>
                            void applyTicketAction(
                              () => closeTicket({ ticketId: selectedTicket.id }),
                              "Ticket closed",
                            )
                          }
                        >
                          Close
                        </Button>
                      )}
                      {selectedTicket.status === "reopen_requested" && (
                        <>
                          <Button
                            size="sm"
                            disabled={savingMeta}
                            onClick={() =>
                              void applyTicketAction(
                                () => decideReopen({ ticketId: selectedTicket.id, approve: true }),
                                "Reopen approved",
                              )
                            }
                          >
                            Approve reopen
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingMeta}
                            onClick={() =>
                              void applyTicketAction(
                                () => decideReopen({ ticketId: selectedTicket.id, approve: false }),
                                "Reopen rejected",
                              )
                            }
                          >
                            Reject reopen
                          </Button>
                        </>
                      )}
                    </div>
                    <FieldGrid>
                      <Field label="Priority" htmlFor="ticket-meta-priority">
                        <select
                          id="ticket-meta-priority"
                          value={metaDraft.priority}
                          onChange={(event) =>
                            setMetaDraft((current) => ({
                              ...current,
                              priority: event.target.value,
                            }))
                          }
                          className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-card focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </Field>
                      <Field label="Assignee" htmlFor="ticket-meta-assignee">
                        <Input
                          id="ticket-meta-assignee"
                          value={metaDraft.assignee_name}
                          onChange={(event) =>
                            setMetaDraft((current) => ({
                              ...current,
                              assignee_name: event.target.value,
                            }))
                          }
                          placeholder="LIVEY owner"
                        />
                      </Field>
                    </FieldGrid>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void saveTicketPriority()}
                      disabled={savingMeta}
                    >
                      {savingMeta ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save priority & assignee
                    </Button>
                  </div>
                ) : selectedTicket.status === "closed" ? (
                  <div className="rounded-lg border p-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const reason = window.prompt("Why should this ticket reopen?");
                        if (reason && reason.trim()) {
                          void applyTicketAction(
                            () =>
                              requestReopen({ ticketId: selectedTicket.id, reason: reason.trim() }),
                            "Reopen requested",
                          );
                        }
                      }}
                    >
                      Request reopen
                    </Button>
                  </div>
                ) : null}

                <Separator />

                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Thread
                  </div>
                  {comments.length === 0 ? (
                    <EmptyState
                      className="rounded-lg border border-dashed py-8"
                      icon={<MessageSquare className="h-5 w-5" />}
                      title="No replies yet"
                      description="Post the first reply below to start the conversation."
                    />
                  ) : (
                    comments.map((comment) => (
                      <div
                        key={comment.id}
                        className={`rounded-lg border p-4 ${
                          comment.is_internal ? "border-warning/40 tint-warning" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{comment.author_name}</div>
                          {comment.is_internal && <Badge tone="warning">Internal Note</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {comment.author_role.replace(/_/g, " ")} ·{" "}
                          {formatDateTimeLabel(comment.created_at)}
                        </div>
                        <div className="mt-3 text-sm">{comment.body}</div>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3">
                  <Field label="Add reply" htmlFor="ticket-reply">
                    <Textarea
                      id="ticket-reply"
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      placeholder="Share the next step, answer, or follow-up."
                    />
                  </Field>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Button onClick={() => void addReply()} disabled={savingReply}>
                      {savingReply ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Post reply
                    </Button>
                    {(hasRole("super_admin") || hasRole("livey_support")) && (
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={replyIsInternal}
                          onChange={(e) => setReplyIsInternal(e.target.checked)}
                          className="rounded border-input text-primary"
                        />
                        Mark as internal note (hidden from partner)
                      </label>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create ticket"
        description="Start a new support conversation for your partner workspace."
        busy={creating}
        submitLabel="Create ticket"
        busyLabel="Creating…"
        submitDisabled={!ticketDraft.subject.trim() || !ticketDraft.description.trim()}
        onSubmit={createTicket}
        size="lg"
      >
        <Field label="Subject" htmlFor="ticket-subject" required>
          <Input
            id="ticket-subject"
            value={ticketDraft.subject}
            onChange={(event) =>
              setTicketDraft((current) => ({ ...current, subject: event.target.value }))
            }
            placeholder="Need help with partner approval"
            autoFocus
          />
        </Field>
        <FieldGrid>
          <Field label="Priority" htmlFor="ticket-priority">
            <Select
              value={ticketDraft.priority}
              onValueChange={(value) =>
                setTicketDraft((current) => ({ ...current, priority: value }))
              }
            >
              <SelectTrigger id="ticket-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Product SKU" htmlFor="ticket-product-sku" hint="Optional">
            <Input
              id="ticket-product-sku"
              value={ticketDraft.productSku}
              onChange={(event) =>
                setTicketDraft((current) => ({ ...current, productSku: event.target.value }))
              }
              placeholder="e.g. HW-1000"
            />
          </Field>
        </FieldGrid>
        <Field label="Serial number" htmlFor="ticket-serial" hint="Optional">
          <Input
            id="ticket-serial"
            value={ticketDraft.serialNumber}
            onChange={(event) =>
              setTicketDraft((current) => ({ ...current, serialNumber: event.target.value }))
            }
            placeholder="e.g. SN-99812-XX"
          />
        </Field>
        <Field label="Description" htmlFor="ticket-description" required>
          <Textarea
            id="ticket-description"
            rows={5}
            value={ticketDraft.description}
            onChange={(event) =>
              setTicketDraft((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="Describe the issue, expected behavior, and any business impact."
          />
        </Field>
      </FormDialog>
    </div>
  );
}
