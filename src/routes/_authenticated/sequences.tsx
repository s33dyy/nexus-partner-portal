import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckSquare,
  ChevronRight,
  Clock,
  Loader2,
  Mail,
  MailX,
  Play,
  Plus,
  RefreshCcw,
  Send,
  Square,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { EnrollDialog, type ContactDraft } from "@/components/outreach/enroll-dialog";
import {
  EMPTY_EMAIL_STEP,
  EMPTY_TASK_STEP,
  SequenceBuilder,
  type SequenceSettingsDraft,
} from "@/components/outreach/sequence-builder";
import { EmptyState, PageHeader, StatTile } from "@/components/page-header";
import { RecordList, RecordListSkeleton, RecordRow } from "@/components/record-list";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OUTREACH_UNENROLL_REASONS,
  getUnenrollReason,
  type OutreachSequenceStatus,
  type SequenceStepDraft,
} from "@/domain/contracts/outreach";
import { useAuth } from "@/hooks/use-auth";
import {
  createSequence,
  enrollContacts,
  getEnrollmentTimeline,
  getSequenceDetail,
  listSequences,
  saveSequenceSteps,
  setSequenceStatus,
  unenrollContact,
} from "@/integrations/local/outreach";
import { formatDateTimeLabel } from "@/lib/date-utils";
import type {
  EnrollmentView,
  ExecutionView,
  SequenceDetail,
  SequenceListItem,
} from "@/server/outreach-queries.server";

export const Route = createFileRoute("/_authenticated/sequences")({
  component: SequencesPage,
});

const TABS = ["manage", "analyze"] as const;
type SequencesTab = (typeof TABS)[number];

const STATUS_TONE: Record<OutreachSequenceStatus, "neutral" | "success" | "warning"> = {
  draft: "neutral",
  active: "success",
  archived: "warning",
};

const ENROLLMENT_TONE: Record<string, "brand" | "success" | "neutral"> = {
  active: "brand",
  finished: "success",
  unenrolled: "neutral",
};

const EXECUTION_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  pending: "neutral",
  sending: "brand",
  sent: "success",
  skipped: "warning",
  failed: "danger",
};

const EMPTY_SETTINGS: SequenceSettingsDraft = {
  name: "",
  description: "",
  businessDaysOnly: true,
  threadAsReply: true,
  unenrollOnDealCreated: true,
};

/** The starter cadence a new sequence opens with — an email, a same-day
 * nudge to connect, and a follow-up two days later. A blank editor makes
 * people guess at a shape; this one shows it. */
function starterSteps(): SequenceStepDraft[] {
  return [
    {
      ...EMPTY_EMAIL_STEP,
      dayOffset: 0,
      subject: "Thanks for downloading",
      body: "Hi {{first_name|there}},\n\nThanks for taking a look at our report. If it raised any questions about what LIVEY could do for {{company|your team}}, I'm happy to talk them through.\n\nBest,\n{{sender_name}}",
    },
    { ...EMPTY_TASK_STEP, dayOffset: 0, taskTitle: "Connect with {{first_name}} on LinkedIn" },
    {
      ...EMPTY_EMAIL_STEP,
      dayOffset: 2,
      subject: "One more thing that might help",
      body: "Hi {{first_name|there}},\n\nI thought this might be useful given the challenges teams in {{segment|your space}} are working through right now.\n\nBest,\n{{sender_name}}",
    },
  ];
}

function percent(value: number): string {
  return `${value}%`;
}

function SequencesPage() {
  const { can } = useAuth();
  const canRead = can("outreach", "read");
  const canCreate = can("outreach", "create");
  const canUpdate = can("outreach", "update");

  const [tab, setTab] = useState<SequencesTab>("manage");
  const [sequences, setSequences] = useState<SequenceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SequenceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<"create" | "edit">("create");
  const [settings, setSettings] = useState<SequenceSettingsDraft>(EMPTY_SETTINGS);
  const [steps, setSteps] = useState<SequenceStepDraft[]>(starterSteps);
  const [saving, setSaving] = useState(false);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  const [timelineFor, setTimelineFor] = useState<EnrollmentView | null>(null);
  const [timeline, setTimeline] = useState<ExecutionView[]>([]);
  // Distinct from `timeline.length === 0`, which cannot tell "still loading"
  // apart from "loaded, and there is nothing" — reading the spinner off the
  // array length left the dialog spinning forever whenever the fetch failed.
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [unenrollFor, setUnenrollFor] = useState<EnrollmentView | null>(null);
  const [unenrollReason, setUnenrollReason] = useState("replied");
  const [unenrolling, setUnenrolling] = useState(false);

  const loadSequences = useCallback(async () => {
    setLoading(true);
    const result = await listSequences();
    if (result.ok) {
      setSequences(result.data);
      setSelectedId((current) => current ?? result.data[0]?.id ?? null);
    } else {
      setSequences([]);
      toast.error(result.failure.reason || "Could not load sequences");
    }
    setLoading(false);
  }, []);

  // Which sequence the newest detail request was for. Clicking A then B
  // fires two requests, and nothing guarantees they come back in that order —
  // without this guard a slow response for A can land after B's and leave the
  // panel showing A while the list highlights B. That is not just a display
  // glitch: every action in the panel reads detail.sequence.id and .version,
  // so Archive would then archive the sequence the user did not select.
  const detailRequestFor = useRef<string | null>(null);

  const loadDetail = useCallback(async (sequenceId: string) => {
    detailRequestFor.current = sequenceId;
    setDetailLoading(true);
    const result = await getSequenceDetail(sequenceId);
    if (detailRequestFor.current !== sequenceId) return;
    setDetail(result.ok ? result.data : null);
    if (!result.ok) toast.error(result.failure.reason || "Could not load that sequence");
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    void loadSequences();
  }, [canRead, loadSequences]);

  useEffect(() => {
    if (!canRead || !selectedId) {
      detailRequestFor.current = null;
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [canRead, loadDetail, selectedId]);

  const totals = useMemo(() => {
    return sequences.reduce(
      (accumulator, sequence) => ({
        live: accumulator.live + (sequence.status === "active" ? 1 : 0),
        activeContacts: accumulator.activeContacts + sequence.analytics.active,
        emailsSent: accumulator.emailsSent + sequence.analytics.emailsSent,
        emailsOpened: accumulator.emailsOpened + sequence.analytics.emailsOpened,
        enrolled: accumulator.enrolled + sequence.analytics.enrolled,
        meetings: accumulator.meetings + sequence.analytics.meetings,
      }),
      { live: 0, activeContacts: 0, emailsSent: 0, emailsOpened: 0, enrolled: 0, meetings: 0 },
    );
  }, [sequences]);

  const openCreate = () => {
    setBuilderMode("create");
    setSettings(EMPTY_SETTINGS);
    setSteps(starterSteps());
    setBuilderOpen(true);
  };

  const openEdit = () => {
    if (!detail) return;
    setBuilderMode("edit");
    setSettings({
      name: detail.sequence.name,
      description: detail.sequence.description,
      businessDaysOnly: detail.sequence.businessDaysOnly,
      threadAsReply: detail.sequence.threadAsReply,
      unenrollOnDealCreated: detail.sequence.unenrollOnDealCreated,
    });
    setSteps(
      detail.steps.map((step) => ({
        stepType: step.stepType,
        dayOffset: step.dayOffset,
        subject: step.subject,
        body: step.body,
        taskTitle: step.taskTitle,
        taskPriority: step.taskPriority,
      })),
    );
    setBuilderOpen(true);
  };

  const submitBuilder = async () => {
    setSaving(true);
    try {
      const result =
        builderMode === "create"
          ? await createSequence({
              name: settings.name,
              description: settings.description,
              businessDaysOnly: settings.businessDaysOnly,
              threadAsReply: settings.threadAsReply,
              unenrollOnDealCreated: settings.unenrollOnDealCreated,
              steps,
            })
          : await saveSequenceSteps({
              sequenceId: detail!.sequence.id,
              expectedVersion: detail!.sequence.version,
              name: settings.name,
              description: settings.description,
              businessDaysOnly: settings.businessDaysOnly,
              threadAsReply: settings.threadAsReply,
              unenrollOnDealCreated: settings.unenrollOnDealCreated,
              steps,
            });

      if (!result.ok) {
        toast.error(failureMessage(result.failure));
        return;
      }
      toast.success(builderMode === "create" ? "Sequence created as a draft" : "Sequence saved");
      setBuilderOpen(false);
      await loadSequences();
      setSelectedId(result.subjectId);
      await loadDetail(result.subjectId);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (toStatus: OutreachSequenceStatus) => {
    if (!detail) return;
    const result = await setSequenceStatus({
      sequenceId: detail.sequence.id,
      expectedVersion: detail.sequence.version,
      toStatus,
    });
    if (!result.ok) {
      toast.error(failureMessage(result.failure));
      return;
    }
    toast.success(
      toStatus === "active"
        ? "Sequence is live — contacts can be enrolled"
        : toStatus === "draft"
          ? detail.sequence.status === "archived"
            ? "Sequence restored to draft"
            : "Sequence paused back to draft"
          : "Sequence archived — everyone still running it has been stopped",
    );
    await loadSequences();
    await loadDetail(detail.sequence.id);
  };

  const submitEnrollment = async (contacts: ContactDraft[]) => {
    if (!detail) return;
    setEnrolling(true);
    try {
      const result = await enrollContacts({
        sequenceId: detail.sequence.id,
        contacts: contacts.map((contact) => ({
          customerId: contact.customerId || null,
          contactName: contact.contactName,
          contactEmail: contact.contactEmail,
          personalNote: contact.personalNote,
        })),
      });

      if (!result.ok) {
        toast.error(failureMessage(result.failure));
        return;
      }

      const enrolled = result.outcomes.filter((outcome) => outcome.enrolled).length;
      const rejected = result.outcomes.filter((outcome) => !outcome.enrolled);
      if (enrolled > 0) {
        toast.success(`${enrolled} contact${enrolled === 1 ? "" : "s"} enrolled`);
      }
      // Every rejection names the address and the reason: a batch that
      // silently drops two of five is how a rep discovers a week later that
      // half their list was never contacted.
      for (const outcome of rejected) {
        toast.error(`${outcome.contactEmail}: ${outcome.reason}`);
      }
      if (enrolled > 0) {
        setEnrollOpen(false);
        await loadSequences();
        await loadDetail(detail.sequence.id);
      }
    } finally {
      setEnrolling(false);
    }
  };

  const openTimeline = async (enrollment: EnrollmentView) => {
    setTimelineFor(enrollment);
    setTimeline([]);
    setTimelineLoading(true);
    try {
      const result = await getEnrollmentTimeline(enrollment.id);
      if (result.ok) setTimeline(result.data);
      else toast.error(result.failure.reason || "Could not load that timeline");
    } finally {
      setTimelineLoading(false);
    }
  };

  const submitUnenroll = async () => {
    if (!unenrollFor) return;
    setUnenrolling(true);
    try {
      const result = await unenrollContact({
        enrollmentId: unenrollFor.id,
        expectedVersion: unenrollFor.version,
        reasonKey: unenrollReason,
      });
      if (!result.ok) {
        toast.error(failureMessage(result.failure));
        return;
      }
      toast.success("Contact unenrolled");
      setUnenrollFor(null);
      await loadSequences();
      if (selectedId) await loadDetail(selectedId);
    } finally {
      setUnenrolling(false);
    }
  };

  if (!canRead) {
    return (
      <AccessDeniedPage
        title="Outreach sequences"
        roleLabel="outreach"
        description="Sequences automate follow-up email and task reminders for your own customers."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Automation"
        icon={<Send className="h-3.5 w-3.5" />}
        title="Outreach sequences"
        description="Multi-step follow-up that sends itself — automated emails, task reminders for the human steps, and an exit the moment a contact replies or a deal opens."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void loadSequences();
                // Also the detail, so a panel left empty by a failed load has
                // a way back. Every mutation path already reloads both; this
                // was the one button that refreshed half the screen.
                if (selectedId) void loadDetail(selectedId);
              }}
            >
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
            {canCreate ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New sequence
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Live sequences"
          value={totals.live}
          hint={`${sequences.length} total`}
          icon={<Send className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Contacts running"
          value={totals.activeContacts}
          hint={`${totals.enrolled} enrolled all-time`}
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label="Emails sent"
          value={totals.emailsSent}
          hint={`${totals.emailsOpened} opened`}
          icon={<Mail className="h-4 w-4" />}
        />
        <StatTile
          label="Meetings booked"
          value={totals.meetings}
          hint={
            totals.enrolled > 0
              ? `${Math.round((totals.meetings / totals.enrolled) * 1000) / 10}% of enrolled`
              : "No contacts enrolled yet"
          }
          icon={<BarChart3 className="h-4 w-4" />}
          tone="success"
        />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as SequencesTab)}>
        <TabsList>
          <TabsTrigger value="manage">Manage</TabsTrigger>
          <TabsTrigger value="analyze">Analyze</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "analyze" ? (
        <AnalyzePanel sequences={sequences} loading={loading} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Sequences</CardTitle>
              <CardDescription>Pick one to see its steps and contacts.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <RecordListSkeleton rows={4} />
              ) : sequences.length === 0 ? (
                <EmptyState
                  icon={<Send className="h-5 w-5" />}
                  title="No sequences yet"
                  description="A sequence is an ordered set of emails and task reminders that runs itself once you enrol a contact."
                  action={
                    canCreate ? (
                      <Button size="sm" onClick={openCreate}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        New sequence
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <RecordList>
                  {sequences.map((sequence) => (
                    <RecordRow
                      key={sequence.id}
                      tone={STATUS_TONE[sequence.status]}
                      selected={sequence.id === selectedId}
                      onClick={() => setSelectedId(sequence.id)}
                      title={sequence.name}
                      subtitle={`${sequence.stepCount} step${sequence.stepCount === 1 ? "" : "s"} · ${sequence.durationDays} day${sequence.durationDays === 1 ? "" : "s"} · ${sequence.automationPercent}% automated`}
                      meta={
                        <span className="text-xs text-muted-foreground">
                          {sequence.analytics.active} running
                        </span>
                      }
                      trailing={
                        <Badge tone={STATUS_TONE[sequence.status]}>{sequence.status}</Badge>
                      }
                    />
                  ))}
                </RecordList>
              )}
            </CardContent>
          </Card>

          <SequenceDetailPanel
            detail={detail}
            loading={detailLoading}
            canUpdate={canUpdate}
            canCreate={canCreate}
            onEdit={openEdit}
            onStatusChange={changeStatus}
            onEnroll={() => setEnrollOpen(true)}
            onTimeline={openTimeline}
            onUnenroll={(enrollment) => {
              setUnenrollFor(enrollment);
              setUnenrollReason("replied");
            }}
          />
        </div>
      )}

      <FormDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        title={builderMode === "create" ? "New sequence" : `Edit “${settings.name}”`}
        description={
          builderMode === "create"
            ? "Sequences start as a draft. Activate it when you're happy, then enrol contacts."
            : "Steps can only be edited while nobody is mid-cadence."
        }
        size="xl"
        busy={saving}
        busyLabel="Saving…"
        submitLabel={builderMode === "create" ? "Create draft" : "Save sequence"}
        submitDisabled={!settings.name.trim() || steps.length === 0}
        onSubmit={submitBuilder}
      >
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <SequenceBuilder
            settings={settings}
            onSettingsChange={setSettings}
            steps={steps}
            onStepsChange={setSteps}
            disabled={saving}
            runningContacts={builderMode === "edit" ? (detail?.sequence.analytics.active ?? 0) : 0}
          />
        </div>
      </FormDialog>

      {detail ? (
        <EnrollDialog
          open={enrollOpen}
          onOpenChange={setEnrollOpen}
          sequenceName={detail.sequence.name}
          busy={enrolling}
          onSubmit={submitEnrollment}
        />
      ) : null}

      {/* Read-only, so a plain Dialog rather than FormDialog: there is
          nothing to submit here, and FormDialog's Cancel/Submit pair would
          render two buttons that both just say "Close". */}
      <Dialog
        open={!!timelineFor}
        onOpenChange={(open) => {
          if (!open) setTimelineFor(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{timelineFor?.contactName || timelineFor?.contactEmail}</DialogTitle>
            <DialogDescription>
              {timelineFor
                ? `${timelineFor.contactEmail} · enrolled ${timelineFor.startDate}`
                : null}
            </DialogDescription>
          </DialogHeader>
          {timelineLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading the timeline…
            </div>
          ) : timeline.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">
              No steps to show for this contact.
            </div>
          ) : (
            <ol className="space-y-2">
              {timeline.map((execution) => (
                <li key={execution.id} className="rounded-md border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={execution.stepType === "email" ? "brand" : "info"}>
                      {execution.stepType === "email" ? (
                        <Mail className="mr-1 h-3 w-3" />
                      ) : (
                        <CheckSquare className="mr-1 h-3 w-3" />
                      )}
                      Step {execution.stepIndex + 1}
                    </Badge>
                    <Badge tone={EXECUTION_TONE[execution.status] ?? "neutral"}>
                      {execution.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {execution.sentAt
                        ? formatDateTimeLabel(execution.sentAt)
                        : `due ${formatDateTimeLabel(execution.scheduledFor)}`}
                    </span>
                    {execution.openCount > 0 ? (
                      <Badge tone="success">Opened {execution.openCount}×</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1.5 text-[13px]">
                    {execution.stepType === "email" ? execution.subject : execution.taskTitle}
                  </div>
                  {execution.detail ? (
                    <div className="mt-1 text-xs text-muted-foreground">{execution.detail}</div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>

      <FormDialog
        open={!!unenrollFor}
        onOpenChange={(open) => {
          if (!open) setUnenrollFor(null);
        }}
        title="Stop this cadence"
        description={
          unenrollFor
            ? `${unenrollFor.contactName || unenrollFor.contactEmail} stops receiving the remaining steps.`
            : undefined
        }
        busy={unenrolling}
        busyLabel="Stopping…"
        submitLabel="Unenrol"
        submitVariant="destructive"
        onSubmit={submitUnenroll}
      >
        <Select value={unenrollReason} onValueChange={setUnenrollReason}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTREACH_UNENROLL_REASONS.filter((reason) => reason.manual).map((reason) => (
              <SelectItem key={reason.key} value={reason.key}>
                {reason.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          The outcome you pick is what the Analyze tab counts as a reply or a booked meeting.
        </p>
      </FormDialog>
    </div>
  );
}

function SequenceDetailPanel({
  detail,
  loading,
  canUpdate,
  canCreate,
  onEdit,
  onStatusChange,
  onEnroll,
  onTimeline,
  onUnenroll,
}: {
  detail: SequenceDetail | null;
  loading: boolean;
  canUpdate: boolean;
  canCreate: boolean;
  onEdit: () => void;
  onStatusChange: (status: OutreachSequenceStatus) => void | Promise<void>;
  onEnroll: () => void;
  onTimeline: (enrollment: EnrollmentView) => void | Promise<void>;
  onUnenroll: (enrollment: EnrollmentView) => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <RecordListSkeleton rows={5} />
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card>
        <EmptyState
          icon={<Send className="h-5 w-5" />}
          title="No sequence selected"
          description="Pick a sequence on the left, or create one to get started."
        />
      </Card>
    );
  }

  const { sequence, steps, enrollments } = detail;
  const running = enrollments.filter((enrollment) => enrollment.status === "active");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                {sequence.name}
                <Badge tone={STATUS_TONE[sequence.status]}>{sequence.status}</Badge>
              </CardTitle>
              <CardDescription>
                {sequence.description || "No description."} · {sequence.stepCount} steps ·{" "}
                {sequence.durationDays} days · {sequence.automationPercent}% automated
                {sequence.businessDaysOnly ? " · business days only" : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {canUpdate && sequence.status === "draft" ? (
                <Button size="sm" onClick={() => void onStatusChange("active")}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Activate
                </Button>
              ) : null}
              {canUpdate && sequence.status === "active" ? (
                <Button variant="outline" size="sm" onClick={() => void onStatusChange("draft")}>
                  <Square className="mr-1.5 h-3.5 w-3.5" />
                  Pause
                </Button>
              ) : null}
              {canUpdate && sequence.status !== "archived" ? (
                <Button variant="outline" size="sm" onClick={() => void onStatusChange("archived")}>
                  Archive
                </Button>
              ) : null}
              {/* Archived is not a dead end. The contract allows archived →
                  draft (never straight back to active — a sequence that was
                  switched off should be re-read before it starts mailing
                  again), so the UI has to offer that step or an archived
                  sequence becomes unrecoverable. */}
              {canUpdate && sequence.status === "archived" ? (
                <Button variant="outline" size="sm" onClick={() => void onStatusChange("draft")}>
                  Restore to draft
                </Button>
              ) : null}
              {canUpdate ? (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  Edit steps
                </Button>
              ) : null}
              {canCreate && sequence.status === "active" ? (
                <Button size="sm" onClick={onEnroll}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  Enrol contacts
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {steps.map((step) => (
              <li key={step.id} className="flex gap-3 rounded-md border bg-card p-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                  {step.stepIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={step.stepType === "email" ? "brand" : "info"}>
                      {step.stepType === "email" ? (
                        <Mail className="mr-1 h-3 w-3" />
                      ) : (
                        <CheckSquare className="mr-1 h-3 w-3" />
                      )}
                      {step.stepType === "email" ? "Automated email" : "Task"}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {step.dayOffset === 0 ? "Day of enrolment" : `Day ${step.dayOffset}`}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[13px] font-medium">
                    {step.stepType === "email" ? step.subject : step.taskTitle}
                  </div>
                  {step.stepType === "email" && step.body ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{step.body}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Contacts — {running.length} running of {enrollments.length}
          </CardTitle>
          <CardDescription>
            Open rate {percent(sequence.analytics.openRate)} · reply rate{" "}
            {percent(sequence.analytics.replyRate)} · meeting rate{" "}
            {percent(sequence.analytics.meetingRate)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enrollments.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="Nobody enrolled yet"
              description={
                sequence.status === "active"
                  ? "Enrol a contact and the first step goes out on the next sweep."
                  : "Activate the sequence first, then enrol contacts."
              }
            />
          ) : (
            <RecordList>
              {enrollments.map((enrollment) => {
                const reason = getUnenrollReason(enrollment.unenrollReason);
                const label = enrollment.contactName || enrollment.contactEmail;
                return (
                  // No row-level onClick: RecordRow renders itself as a
                  // <button> when it has one, and the two row actions below
                  // are buttons of their own. Nesting them would be invalid
                  // HTML and breaks hydration. Without onClick the row is a
                  // plain <div> and the actions are the affordance.
                  <RecordRow
                    key={enrollment.id}
                    tone={ENROLLMENT_TONE[enrollment.status] ?? "neutral"}
                    title={label}
                    subtitle={
                      enrollment.companyName
                        ? `${enrollment.contactEmail} · ${enrollment.companyName}`
                        : enrollment.contactEmail
                    }
                    meta={
                      <span className="text-xs text-muted-foreground">
                        {enrollment.stepsDone}/{enrollment.stepsTotal} steps
                        {enrollment.nextStepAt
                          ? ` · next ${formatDateTimeLabel(enrollment.nextStepAt)}`
                          : ""}
                      </span>
                    }
                    trailing={
                      <div className="flex items-center gap-1.5">
                        <Badge tone={ENROLLMENT_TONE[enrollment.status] ?? "neutral"}>
                          {reason ? reason.label : enrollment.status}
                        </Badge>
                        {canUpdate && enrollment.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            aria-label={`Unenrol ${label}`}
                            onClick={() => onUnenroll(enrollment)}
                          >
                            <MailX className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2 text-xs"
                          onClick={() => void onTimeline(enrollment)}
                        >
                          Timeline
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    }
                  />
                );
              })}
            </RecordList>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AnalyzePanel({ sequences, loading }: { sequences: SequenceListItem[]; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <RecordListSkeleton rows={5} />
        </CardContent>
      </Card>
    );
  }

  if (sequences.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="Nothing to analyse yet"
          description="Once a sequence has enrolled contacts, its open, reply and meeting rates appear here."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Sequence performance</CardTitle>
        <CardDescription>
          Open rate counts unique opens per email sent. Reply and meeting rates count contacts, not
          messages — a longer sequence shouldn&rsquo;t look worse just for having more steps.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 pr-3">Sequence</th>
              <th className="pb-2 pr-3 text-right">Enrolled</th>
              <th className="pb-2 pr-3 text-right">Running</th>
              <th className="pb-2 pr-3 text-right">Sent</th>
              <th className="pb-2 pr-3 text-right">Open rate</th>
              <th className="pb-2 pr-3 text-right">Replies</th>
              <th className="pb-2 pr-3 text-right">Reply rate</th>
              <th className="pb-2 pr-3 text-right">Meetings</th>
              <th className="pb-2 text-right">Meeting rate</th>
            </tr>
          </thead>
          <tbody>
            {sequences.map((sequence) => (
              <tr key={sequence.id} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <div className="font-medium">{sequence.name}</div>
                  <div className="text-xs text-muted-foreground">{sequence.status}</div>
                </td>
                <td className="py-2 pr-3 text-right" data-numeric>
                  {sequence.analytics.enrolled}
                </td>
                <td className="py-2 pr-3 text-right" data-numeric>
                  {sequence.analytics.active}
                </td>
                <td className="py-2 pr-3 text-right" data-numeric>
                  {sequence.analytics.emailsSent}
                </td>
                <td className="py-2 pr-3 text-right" data-numeric>
                  {percent(sequence.analytics.openRate)}
                </td>
                <td className="py-2 pr-3 text-right" data-numeric>
                  {sequence.analytics.replies}
                </td>
                <td className="py-2 pr-3 text-right" data-numeric>
                  {percent(sequence.analytics.replyRate)}
                </td>
                <td className="py-2 pr-3 text-right" data-numeric>
                  {sequence.analytics.meetings}
                </td>
                <td className="py-2 text-right" data-numeric>
                  {percent(sequence.analytics.meetingRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function failureMessage(failure: { code: string; message: string } & Record<string, unknown>) {
  if (failure.code === "VALIDATION_FAILED") return failure.message;
  if (failure.code === "OPTIMISTIC_CONFLICT") {
    return "Somebody else changed this sequence — refresh and try again.";
  }
  if (failure.code === "POLICY_DENIED") {
    return typeof failure.reason === "string" ? failure.reason : failure.message;
  }
  return failure.message;
}
