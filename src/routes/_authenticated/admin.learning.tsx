import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Edit2,
  GraduationCap,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/local/client";

export const Route = createFileRoute("/_authenticated/admin/learning")({
  component: AdminLearningPage,
});

type TrackRow = {
  id: string;
  title: string;
  description: string | null;
  tier_requirement: string | null;
  is_published: boolean;
  created_at: string;
};

type SubjectRow = {
  id: string;
  track_id: string;
  title: string;
  description: string | null;
  order_index: number;
};

type LessonRow = {
  id: string;
  subject_id: string;
  title: string;
  content_type: string;
  order_index: number;
  is_required: boolean;
};

const TIER_OPTIONS = ["", "Registered", "Silver", "Gold", "Platinum"];

function AdminLearningPage() {
  const { hasRole } = useAuth();

  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);

  // Track dialog state
  const [trackDialogOpen, setTrackDialogOpen] = useState(false);
  const [trackDraft, setTrackDraft] = useState({
    title: "",
    description: "",
    tier_requirement: "",
    is_published: false,
  });
  const [savingTrack, setSavingTrack] = useState(false);
  const [editTrackId, setEditTrackId] = useState<string | null>(null);

  // Subject dialog state
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState({ title: "", description: "" });
  const [savingSubject, setSavingSubject] = useState(false);
  const [editSubjectId, setEditSubjectId] = useState<string | null>(null);

  if (!hasRole("super_admin")) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        Access restricted to Super Admin.
      </div>
    );
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [trackRes, subjectRes, lessonRes] = await Promise.all([
        supabase.from("learning_tracks").select("*").order("created_at", { ascending: true }),
        supabase
          .from("learning_subjects")
          .select("*")
          .order("order_index", { ascending: true }),
        supabase
          .from("learning_lessons")
          .select("id, subject_id, title, content_type, order_index, is_required")
          .order("order_index", { ascending: true }),
      ]);
      if (trackRes.error) throw trackRes.error;
      setTracks((trackRes.data as TrackRow[] | null) ?? []);
      setSubjects((subjectRes.data as SubjectRow[] | null) ?? []);
      setLessons((lessonRes.data as LessonRow[] | null) ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load content");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Track CRUD ───────────────────────────────────────────────────────────
  const openNewTrack = () => {
    setEditTrackId(null);
    setTrackDraft({ title: "", description: "", tier_requirement: "", is_published: false });
    setTrackDialogOpen(true);
  };

  const openEditTrack = (track: TrackRow) => {
    setEditTrackId(track.id);
    setTrackDraft({
      title: track.title,
      description: track.description ?? "",
      tier_requirement: track.tier_requirement ?? "",
      is_published: track.is_published,
    });
    setTrackDialogOpen(true);
  };

  const saveTrack = async () => {
    if (!trackDraft.title.trim()) {
      toast.error("Track title is required");
      return;
    }
    setSavingTrack(true);
    try {
      const payload = {
        title: trackDraft.title.trim(),
        description: trackDraft.description.trim() || null,
        tier_requirement: trackDraft.tier_requirement || null,
        is_published: trackDraft.is_published,
        updated_at: new Date().toISOString(),
      };
      if (editTrackId) {
        const { error } = await supabase
          .from("learning_tracks")
          .update(payload)
          .eq("id", editTrackId);
        if (error) throw error;
        toast.success("Track updated");
      } else {
        const { error } = await supabase.from("learning_tracks").insert({
          ...payload,
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
        toast.success("Track created");
      }
      setTrackDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save track");
    } finally {
      setSavingTrack(false);
    }
  };

  const toggleTrackPublish = async (track: TrackRow) => {
    try {
      const { error } = await supabase
        .from("learning_tracks")
        .update({ is_published: !track.is_published, updated_at: new Date().toISOString() })
        .eq("id", track.id);
      if (error) throw error;
      toast.success(track.is_published ? "Track unpublished" : "Track published");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update track");
    }
  };

  // ─── Subject CRUD ─────────────────────────────────────────────────────────
  const openNewSubject = (trackId: string) => {
    setSelectedTrackId(trackId);
    setEditSubjectId(null);
    setSubjectDraft({ title: "", description: "" });
    setSubjectDialogOpen(true);
  };

  const openEditSubject = (subject: SubjectRow) => {
    setSelectedTrackId(subject.track_id);
    setEditSubjectId(subject.id);
    setSubjectDraft({ title: subject.title, description: subject.description ?? "" });
    setSubjectDialogOpen(true);
  };

  const saveSubject = async () => {
    if (!subjectDraft.title.trim() || !selectedTrackId) {
      toast.error("Subject title is required");
      return;
    }
    setSavingSubject(true);
    try {
      const trackSubjects = subjects.filter((s) => s.track_id === selectedTrackId);
      const payload = {
        track_id: selectedTrackId,
        title: subjectDraft.title.trim(),
        description: subjectDraft.description.trim() || null,
        order_index: editSubjectId
          ? subjects.find((s) => s.id === editSubjectId)?.order_index ?? trackSubjects.length
          : trackSubjects.length,
        updated_at: new Date().toISOString(),
      };
      if (editSubjectId) {
        const { error } = await supabase
          .from("learning_subjects")
          .update(payload)
          .eq("id", editSubjectId);
        if (error) throw error;
        toast.success("Subject updated");
      } else {
        const { error } = await supabase.from("learning_subjects").insert({
          ...payload,
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
        toast.success("Subject added");
      }
      setSubjectDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save subject");
    } finally {
      setSavingSubject(false);
    }
  };

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId) ?? null;
  const trackSubjects = selectedTrack
    ? subjects.filter((s) => s.track_id === selectedTrack.id)
    : [];
  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId) ?? null;
  const subjectLessons = selectedSubject
    ? lessons.filter((l) => l.subject_id === selectedSubject.id)
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <GraduationCap className="h-3.5 w-3.5" />
            Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Learning management</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Create and manage tracks, subjects, and lessons for the LIVEY Insight Hub.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openNewTrack}>
            <Plus className="mr-2 h-4 w-4" />
            New track
          </Button>
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

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
        {/* Tracks column */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Tracks</CardTitle>
                <CardDescription>Select a track to view and edit subjects.</CardDescription>
              </div>
              <Badge variant="secondary">{tracks.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tracks...
              </div>
            ) : tracks.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No tracks yet. Create one to get started.
              </div>
            ) : (
              <div className="divide-y">
                {tracks.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      setSelectedTrackId(track.id);
                      setSelectedSubjectId(null);
                    }}
                    className={`flex w-full flex-col gap-1 px-5 py-4 text-left transition hover:bg-muted/30 ${
                      selectedTrackId === track.id ? "bg-muted/30" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-sm">{track.title}</span>
                      <div className="flex shrink-0 gap-1">
                        {track.is_published ? (
                          <Badge className="text-xs">Published</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Draft
                          </Badge>
                        )}
                        {track.tier_requirement && (
                          <Badge variant="outline" className="text-xs">
                            {track.tier_requirement}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {track.description && (
                      <div className="truncate text-xs text-muted-foreground">
                        {track.description}
                      </div>
                    )}
                    <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                      {subjects.filter((s) => s.track_id === track.id).length} subjects
                    </div>
                    <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => openEditTrack(track)}
                      >
                        <Edit2 className="mr-1 h-3 w-3" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => void toggleTrackPublish(track)}
                      >
                        {track.is_published ? (
                          <>
                            <Archive className="mr-1 h-3 w-3" /> Unpublish
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Publish
                          </>
                        )}
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Subjects column */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Subjects</CardTitle>
                <CardDescription>
                  {selectedTrack ? `In "${selectedTrack.title}"` : "Select a track first"}
                </CardDescription>
              </div>
              {selectedTrackId && (
                <Button size="sm" onClick={() => openNewSubject(selectedTrackId)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!selectedTrackId ? (
              <div className="p-6 text-sm text-muted-foreground">Select a track to see its subjects.</div>
            ) : trackSubjects.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No subjects yet.</div>
            ) : (
              <div className="divide-y">
                {trackSubjects.map((subject) => (
                  <button
                    key={subject.id}
                    type="button"
                    onClick={() => setSelectedSubjectId(subject.id)}
                    className={`flex w-full flex-col gap-1 px-5 py-4 text-left transition hover:bg-muted/30 ${
                      selectedSubjectId === subject.id ? "bg-muted/30" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{subject.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        #{subject.order_index + 1}
                      </span>
                    </div>
                    {subject.description && (
                      <div className="truncate text-xs text-muted-foreground">
                        {subject.description}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {lessons.filter((l) => l.subject_id === subject.id).length} lessons
                    </div>
                    <div className="mt-1 flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => openEditSubject(subject)}
                      >
                        <Edit2 className="mr-1 h-3 w-3" />
                        Edit
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lessons column */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Lessons</CardTitle>
                <CardDescription>
                  {selectedSubject ? `In "${selectedSubject.title}"` : "Select a subject first"}
                </CardDescription>
              </div>
              {selectedSubjectId && (
                <Button size="sm" variant="outline" disabled>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add lesson
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!selectedSubjectId ? (
              <div className="p-6 text-sm text-muted-foreground">Select a subject to see its lessons.</div>
            ) : subjectLessons.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No lessons yet in this subject.</div>
            ) : (
              <div className="divide-y">
                {subjectLessons.map((lesson) => (
                  <div key={lesson.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{lesson.title}</div>
                      <div className="flex gap-2 text-xs text-muted-foreground">
                        <span className="capitalize">{lesson.content_type.replace(/_/g, " ")}</span>
                        {lesson.is_required && <Badge variant="outline" className="text-[10px] h-4">Required</Badge>}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      #{lesson.order_index + 1}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Track dialog */}
      <Dialog open={trackDialogOpen} onOpenChange={setTrackDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTrackId ? "Edit track" : "New track"}</DialogTitle>
            <DialogDescription>
              Fill in the track details. Tracks are hidden from learners until published.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="track-title">Title *</Label>
              <Input
                id="track-title"
                value={trackDraft.title}
                onChange={(e) => setTrackDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="LIVEY Partner Sales Foundation"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="track-description">Description</Label>
              <Textarea
                id="track-description"
                value={trackDraft.description}
                onChange={(e) => setTrackDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="What will learners achieve in this track?"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="track-tier">Tier requirement</Label>
              <select
                id="track-tier"
                value={trackDraft.tier_requirement}
                onChange={(e) => setTrackDraft((d) => ({ ...d, tier_requirement: e.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t || "No tier requirement"}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="track-published"
                type="checkbox"
                checked={trackDraft.is_published}
                onChange={(e) => setTrackDraft((d) => ({ ...d, is_published: e.target.checked }))}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="track-published" className="cursor-pointer">
                Publish immediately (visible to learners)
              </Label>
            </div>
            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTrackDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveTrack()} disabled={savingTrack}>
                {savingTrack ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editTrackId ? "Save changes" : "Create track"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Subject dialog */}
      <Dialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editSubjectId ? "Edit subject" : "New subject"}</DialogTitle>
            <DialogDescription>
              Subjects group related lessons within a track.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="subject-title">Title *</Label>
              <Input
                id="subject-title"
                value={subjectDraft.title}
                onChange={(e) => setSubjectDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Product overview and positioning"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject-description">Description</Label>
              <Textarea
                id="subject-description"
                value={subjectDraft.description}
                onChange={(e) => setSubjectDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="What does this subject cover?"
                rows={3}
              />
            </div>
            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSubjectDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveSubject()} disabled={savingSubject}>
                {savingSubject ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editSubjectId ? "Save changes" : "Add subject"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
