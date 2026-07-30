import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Headset, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { applyPartnerScope } from "@/lib/partner-scope";
import { type SupportTicketCommentRecord, type SupportTicketRecord } from "@/lib/portal-records";

export const Route = createFileRoute("/_authenticated/support")({
  component: SupportPage,
});

function SupportPage() {
  const { profile, hasRole } = useAuth();
  useRequireAccess("partial");

  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [comments, setComments] = useState<SupportTicketCommentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [savingReply, setSavingReply] = useState(false);
  const [creating, setCreating] = useState(false);
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
  }, [hasRole, profile?.id, profile?.partner_id]);

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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Headset className="h-3.5 w-3.5" />
            Support
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Portal tickets</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create support requests, track replies, and keep conversations inside the portal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
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
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Create ticket</CardTitle>
              <CardDescription>
                Start a new support conversation for your partner workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="ticket-subject">Subject</Label>
                <Input
                  id="ticket-subject"
                  value={ticketDraft.subject}
                  onChange={(event) =>
                    setTicketDraft((current) => ({ ...current, subject: event.target.value }))
                  }
                  placeholder="Need help with partner approval"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ticket-priority">Priority</Label>
                <select
                  id="ticket-priority"
                  value={ticketDraft.priority}
                  onChange={(event) =>
                    setTicketDraft((current) => ({ ...current, priority: event.target.value }))
                  }
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ticket-product-sku">Product SKU (Optional)</Label>
                  <Input
                    id="ticket-product-sku"
                    value={ticketDraft.productSku}
                    onChange={(event) =>
                      setTicketDraft((current) => ({ ...current, productSku: event.target.value }))
                    }
                    placeholder="e.g. HW-1000"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ticket-serial">Serial Number (Optional)</Label>
                  <Input
                    id="ticket-serial"
                    value={ticketDraft.serialNumber}
                    onChange={(event) =>
                      setTicketDraft((current) => ({
                        ...current,
                        serialNumber: event.target.value,
                      }))
                    }
                    placeholder="e.g. SN-99812-XX"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ticket-description">Description</Label>
                <Textarea
                  id="ticket-description"
                  value={ticketDraft.description}
                  onChange={(event) =>
                    setTicketDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Describe the issue, expected behavior, and any business impact."
                />
              </div>
              <Button onClick={() => void createTicket()} disabled={creating}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create ticket
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base">Tickets</CardTitle>
                  <CardDescription>Open any ticket to view the full thread.</CardDescription>
                </div>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tickets"
                  className="w-full max-w-xs"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading tickets...
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  No tickets found for this view.
                </div>
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
                          <Badge variant="outline">{ticket.priority}</Badge>
                          <Badge variant={ticket.status === "closed" ? "secondary" : "default"}>
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
            <CardTitle className="text-base flex items-center gap-2">
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
          <CardContent className="space-y-5 p-6">
            {!selectedTicket ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
                No ticket selected yet.
              </div>
            ) : (
              <>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selectedTicket.priority}</Badge>
                    <Badge variant={selectedTicket.status === "closed" ? "secondary" : "default"}>
                      {selectedTicket.status}
                    </Badge>
                    {selectedTicket.assignee_name ? (
                      <Badge variant="secondary">Assigned to {selectedTicket.assignee_name}</Badge>
                    ) : null}
                    {selectedTicket.status !== "closed" && selectedTicket.resolve_due_at && (
                      <Badge
                        variant={
                          new Date(selectedTicket.resolve_due_at) < new Date()
                            ? "destructive"
                            : "outline"
                        }
                        className={
                          new Date(selectedTicket.resolve_due_at) < new Date()
                            ? ""
                            : "border-amber-500 text-amber-600"
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
                    <div className="mt-4 flex flex-wrap gap-4 rounded-lg bg-background p-3 text-xs">
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

                {hasRole("super_admin") ? (
                  <div className="space-y-3 rounded-xl border p-4">
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
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="grid gap-2">
                        <Label>Priority</Label>
                        <select
                          value={metaDraft.priority}
                          onChange={(event) =>
                            setMetaDraft((current) => ({
                              ...current,
                              priority: event.target.value,
                            }))
                          }
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <Label>Assignee</Label>
                        <Input
                          value={metaDraft.assignee_name}
                          onChange={(event) =>
                            setMetaDraft((current) => ({
                              ...current,
                              assignee_name: event.target.value,
                            }))
                          }
                          placeholder="LIVEY owner"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Button
                          variant="outline"
                          onClick={() => void saveTicketPriority()}
                          disabled={savingMeta}
                        >
                          {savingMeta ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Save priority & assignee
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : selectedTicket.status === "closed" ? (
                  <div className="rounded-xl border p-4">
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
                  <div className="text-sm font-medium">Thread</div>
                  {comments.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                      No replies yet.
                    </div>
                  ) : (
                    comments.map((comment) => (
                      <div
                        key={comment.id}
                        className={`rounded-lg border p-4 ${
                          comment.is_internal ? "border-amber-200 bg-amber-500/5" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{comment.author_name}</div>
                          {comment.is_internal && (
                            <Badge variant="outline" className="border-amber-200 text-amber-600">
                              Internal Note
                            </Badge>
                          )}
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
                  <Label htmlFor="ticket-reply">Add reply</Label>
                  <Textarea
                    id="ticket-reply"
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    placeholder="Share the next step, answer, or follow-up."
                  />
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
    </div>
  );
}
