import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle2,
  Circle,
  GraduationCap,
  Layers,
  Loader2,
  Lock,
  Play,
  Printer,
  RefreshCw,
  Star,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { supabase } from "@/integrations/local/client";
import { completeLesson, enrollInTrack } from "@/integrations/local/learning-commands";
import { formatDateLabel } from "@/lib/date-utils";
import { meetsPartnerTierRequirement } from "@/lib/money";

export const Route = createFileRoute("/_authenticated/insight-hub")({
  component: InsightHubPage,
});

type TrackRow = {
  id: string;
  title: string;
  description: string | null;
  tier_requirement: string | null;
  is_published: boolean;
  created_at: string;
};

type EnrollmentRow = {
  id: string;
  track_id: string;
  status: string;
  progress_percent: number;
  completed_at: string | null;
  certificate_token: string | null;
};

type SubjectRow = {
  id: string;
  track_id: string;
  title: string;
  order_index: number;
};

type LessonRow = {
  id: string;
  subject_id: string;
  title: string;
  content_body: string | null;
  content_type: string;
  duration_minutes: number;
  is_required: boolean;
  order_index: number;
};

type LessonProgressRow = {
  id: string;
  lesson_id: string;
};

type CertificateData = { track: TrackRow; enrollment: EnrollmentRow };

function InsightHubPage() {
  const { profile, hasRole } = useAuth();
  useRequireAccess("partial");

  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [lessonProgress, setLessonProgress] = useState<LessonProgressRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [partnerTier, setPartnerTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enrollingTrackId, setEnrollingTrackId] = useState<string | null>(null);
  const [viewTrackId, setViewTrackId] = useState<string | null>(null);
  const [completingLessonId, setCompletingLessonId] = useState<string | null>(null);
  const [certificateData, setCertificateData] = useState<CertificateData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [trackRes, subjectRes, lessonRes, enrollRes, progressRes, partnerRes] =
        await Promise.all([
          supabase
            .from("learning_tracks")
            .select("*")
            .eq("is_published", true)
            .order("created_at", { ascending: true }),
          supabase
            .from("learning_subjects")
            .select("id, track_id, title, order_index")
            .order("order_index", { ascending: true }),
          supabase
            .from("learning_lessons")
            .select(
              "id, subject_id, title, content_body, content_type, duration_minutes, is_required, order_index",
            )
            .order("order_index", { ascending: true }),
          profile?.id
            ? supabase
                .from("learning_enrollments")
                .select("id, track_id, status, progress_percent, completed_at, certificate_token")
                .eq("user_id", profile.id)
            : Promise.resolve({ data: [], error: null }),
          profile?.id
            ? supabase
                .from("learning_lesson_progress")
                .select("id, lesson_id")
                .eq("user_id", profile.id)
            : Promise.resolve({ data: [], error: null }),
          profile?.partner_id
            ? supabase
                .from("partners")
                .select("id, tier")
                .eq("id", profile.partner_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

      if (trackRes.error) throw trackRes.error;
      setTracks((trackRes.data as TrackRow[] | null) ?? []);
      setSubjects((subjectRes.data as SubjectRow[] | null) ?? []);
      setLessons((lessonRes.data as LessonRow[] | null) ?? []);
      setEnrollments((enrollRes.data as EnrollmentRow[] | null) ?? []);
      setLessonProgress((progressRes.data as LessonProgressRow[] | null) ?? []);
      setPartnerTier((partnerRes.data as { tier: string } | null)?.tier ?? null);
    } catch {
      setTracks([]);
      setSubjects([]);
      setLessons([]);
      setEnrollments([]);
      setLessonProgress([]);
      setPartnerTier(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.id, profile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStart = async (trackId: string) => {
    setEnrollingTrackId(trackId);
    try {
      const result = await enrollInTrack({ trackId });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      toast.success("Enrolled — continue whenever you're ready");
      await load();
      setViewTrackId(trackId);
    } finally {
      setEnrollingTrackId(null);
    }
  };

  const handleCompleteLesson = async (lessonId: string) => {
    setCompletingLessonId(lessonId);
    try {
      const result = await completeLesson({ lessonId });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      await load();
    } finally {
      setCompletingLessonId(null);
    }
  };

  const handleViewCertificate = (track: TrackRow, enrollment: EnrollmentRow | undefined) => {
    if (!enrollment?.certificate_token) {
      toast.error("No certificate on file for this track yet");
      return;
    }
    setCertificateData({ track, enrollment });
  };

  const enrollmentByTrack = Object.fromEntries(enrollments.map((e) => [e.track_id, e]));
  const completedLessonIds = new Set(lessonProgress.map((p) => p.lesson_id));

  const totalCompleted = enrollments.filter((e) => e.status === "completed").length;
  const totalEnrolled = enrollments.length;
  const overallProgress =
    totalEnrolled > 0
      ? Math.round(enrollments.reduce((sum, e) => sum + e.progress_percent, 0) / totalEnrolled)
      : 0;

  const viewTrack = viewTrackId ? (tracks.find((t) => t.id === viewTrackId) ?? null) : null;

  if (viewTrack) {
    return (
      <TrackDetailPanel
        track={viewTrack}
        subjects={subjects.filter((s) => s.track_id === viewTrack.id)}
        lessons={lessons}
        completedLessonIds={completedLessonIds}
        enrollment={enrollmentByTrack[viewTrack.id]}
        completingLessonId={completingLessonId}
        onBack={() => setViewTrackId(null)}
        onCompleteLesson={(lessonId) => void handleCompleteLesson(lessonId)}
        onViewCertificate={() => handleViewCertificate(viewTrack, enrollmentByTrack[viewTrack.id])}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <GraduationCap className="h-3.5 w-3.5" />
            Learning & Certification
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Insight Hub</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Master LIVEY products, grow your partnership tier, and earn certifications that unlock
            partner rewards.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasRole("super_admin") && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/learning">Manage content</Link>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
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

      {/* Learner progress summary */}
      {totalEnrolled > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="space-y-1 p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Tracks enrolled
              </div>
              <div className="text-2xl font-semibold">{totalEnrolled}</div>
              <div className="text-sm text-muted-foreground">Your active learning paths</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-1 p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Completed
              </div>
              <div className="text-2xl font-semibold text-emerald-600">{totalCompleted}</div>
              <div className="text-sm text-muted-foreground">Tracks finished and certified</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 p-5">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Overall progress
                </div>
                <span className="text-sm font-medium">{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
              <div className="text-sm text-muted-foreground">Across all enrolled tracks</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tracks grid */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Learning tracks</h2>
          <Badge variant="secondary">{tracks.length} available</Badge>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tracks...
          </div>
        ) : tracks.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="rounded-full bg-muted p-4">
                <BookOpen className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="max-w-sm">
                <div className="font-medium">No learning tracks available yet</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Content is being prepared. Check back soon or contact your LIVEY Partner Account
                  Manager.
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {tracks.map((track) => {
              const enrollment = enrollmentByTrack[track.id];
              const trackSubjects = subjects.filter((s) => s.track_id === track.id);
              const isCompleted = enrollment?.status === "completed";
              const isEnrolled = !!enrollment;
              const progress = enrollment?.progress_percent ?? 0;
              // Previously blocked every viewer whenever tier_requirement
              // was set, regardless of their actual tier — it never read
              // partnerTier at all, so a Gold/Platinum partner could never
              // enroll in a Gold-gated track through this page either.
              const meetsTier =
                hasRole("super_admin") ||
                meetsPartnerTierRequirement(partnerTier, track.tier_requirement);

              return (
                <Card
                  key={track.id}
                  className={`flex flex-col transition-shadow hover:shadow-md ${isCompleted ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20" : ""}`}
                >
                  <CardHeader className="space-y-2 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        {isCompleted ? (
                          <Trophy className="h-5 w-5 text-emerald-600" />
                        ) : (
                          <Layers className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {isCompleted && (
                          <Badge className="bg-emerald-600 text-white">Certified</Badge>
                        )}
                        {isEnrolled && !isCompleted && (
                          <Badge variant="secondary">In progress</Badge>
                        )}
                        {track.tier_requirement && (
                          <Badge variant="outline">{track.tier_requirement}</Badge>
                        )}
                      </div>
                    </div>
                    <CardTitle className="text-base leading-snug">{track.title}</CardTitle>
                    {track.description && (
                      <CardDescription className="text-sm">{track.description}</CardDescription>
                    )}
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col justify-between space-y-4">
                    {/* Subjects preview */}
                    {trackSubjects.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          {trackSubjects.length} subject{trackSubjects.length !== 1 ? "s" : ""}
                        </div>
                        <div className="space-y-1">
                          {trackSubjects.slice(0, 4).map((subject) => (
                            <div
                              key={subject.id}
                              className="flex items-center gap-2 text-sm text-muted-foreground"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                              <span className="truncate">{subject.title}</span>
                            </div>
                          ))}
                          {trackSubjects.length > 4 && (
                            <div className="pl-5 text-xs text-muted-foreground">
                              +{trackSubjects.length - 4} more subjects
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <Separator />

                    {/* Progress / CTA */}
                    {isEnrolled && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-medium">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    )}

                    <div>
                      {!meetsTier && !isEnrolled ? (
                        <Button variant="outline" className="w-full" disabled>
                          <Lock className="mr-2 h-4 w-4" />
                          {track.tier_requirement} tier required
                        </Button>
                      ) : isCompleted ? (
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => handleViewCertificate(track, enrollment)}
                        >
                          <Star className="mr-2 h-4 w-4 text-amber-500" />
                          View certificate
                        </Button>
                      ) : isEnrolled ? (
                        <Button className="w-full" onClick={() => setViewTrackId(track.id)}>
                          <Play className="mr-2 h-4 w-4" />
                          Continue learning
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          onClick={() => void handleStart(track.id)}
                          disabled={enrollingTrackId === track.id}
                        >
                          {enrollingTrackId === track.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <BookOpen className="mr-2 h-4 w-4" />
                          )}
                          Start track
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <CertificateDialog
        data={certificateData}
        learnerName={profile?.full_name ?? "LIVEY Partner"}
        onClose={() => setCertificateData(null)}
      />
    </div>
  );
}

function TrackDetailPanel({
  track,
  subjects,
  lessons,
  completedLessonIds,
  enrollment,
  completingLessonId,
  onBack,
  onCompleteLesson,
  onViewCertificate,
}: {
  track: TrackRow;
  subjects: SubjectRow[];
  lessons: LessonRow[];
  completedLessonIds: Set<string>;
  enrollment: EnrollmentRow | undefined;
  completingLessonId: string | null;
  onBack: () => void;
  onCompleteLesson: (lessonId: string) => void;
  onViewCertificate: () => void;
}) {
  const orderedSubjects = [...subjects].sort((a, b) => a.order_index - b.order_index);
  const isCompleted = enrollment?.status === "completed";
  const progress = enrollment?.progress_percent ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to tracks
        </Button>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <GraduationCap className="h-3.5 w-3.5" />
              Learning track
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{track.title}</h1>
            {track.description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{track.description}</p>
            )}
          </div>
          {isCompleted && (
            <Button onClick={onViewCertificate}>
              <Award className="mr-2 h-4 w-4" />
              View certificate
            </Button>
          )}
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Track progress</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </div>

      <div className="space-y-4">
        {orderedSubjects.map((subject) => {
          const subjectLessons = lessons
            .filter((l) => l.subject_id === subject.id)
            .sort((a, b) => a.order_index - b.order_index);

          return (
            <Card key={subject.id}>
              <CardHeader className="border-b">
                <CardTitle className="text-base">{subject.title}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {subjectLessons.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">
                    No lessons published in this subject yet.
                  </div>
                ) : (
                  subjectLessons.map((lesson) => {
                    const done = completedLessonIds.has(lesson.id);
                    const isCompleting = completingLessonId === lesson.id;
                    return (
                      <div key={lesson.id} className="space-y-2 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            {done ? (
                              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                            ) : (
                              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/40" />
                            )}
                            <div>
                              <div className="font-medium text-sm">{lesson.title}</div>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{lesson.duration_minutes} min</span>
                                {lesson.is_required && (
                                  <Badge variant="outline" className="h-4 text-[10px]">
                                    Required
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={done ? "outline" : "default"}
                            disabled={done || isCompleting}
                            onClick={() => onCompleteLesson(lesson.id)}
                          >
                            {isCompleting ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            {done ? "Completed" : "Mark complete"}
                          </Button>
                        </div>
                        {lesson.content_body && (
                          <div className="ml-8 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground whitespace-pre-line">
                            {lesson.content_body}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CertificateDialog({
  data,
  learnerName,
  onClose,
}: {
  data: CertificateData | null;
  learnerName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!data} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="print:hidden">
          <DialogTitle>Certificate of completion</DialogTitle>
          <DialogDescription>
            Issued by the LIVEY Insight Hub — a verification record, not a formal credential.
          </DialogDescription>
        </DialogHeader>
        {data && (
          <>
            <div className="rounded-lg border-2 border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 text-center">
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Award className="h-7 w-7 text-primary" />
                </div>
              </div>
              <div className="mt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                LIVEY Insight Hub
              </div>
              <div className="mt-1 text-lg font-semibold">Certificate of Completion</div>
              <div className="mt-6 text-sm text-muted-foreground">This certifies that</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{learnerName}</div>
              <div className="mt-3 text-sm text-muted-foreground">has successfully completed</div>
              <div className="mt-1 text-xl font-medium">{data.track.title}</div>
              <div className="mt-6 flex justify-center gap-8 text-xs text-muted-foreground">
                <div>
                  <div className="uppercase tracking-widest">Completed</div>
                  <div className="mt-1 font-medium text-foreground">
                    {formatDateLabel(data.enrollment.completed_at)}
                  </div>
                </div>
                <div>
                  <div className="uppercase tracking-widest">Certificate ID</div>
                  <div className="mt-1 font-mono font-medium text-foreground">
                    {data.enrollment.certificate_token?.slice(0, 8).toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 print:hidden">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print / Save as PDF
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
