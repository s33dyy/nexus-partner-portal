import { useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mic,
  Moon,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AssistantChatMessage } from "@/domain/contracts/assistant";
import { DIGEST_EVENING_HOUR, type UserDigest } from "@/domain/contracts/digest";
import { useAuth } from "@/hooks/use-auth";
import { useVoice } from "@/hooks/use-voice";
import { sendAssistantMessage } from "@/integrations/local/assistant";
import { getUserDigest } from "@/integrations/local/digest";

const STORAGE_PREFIX = "livey.digest-seen";

// The digest auto-opens once per SLOT, not once per day: the morning
// briefing looks forward and the evening one looks back at what actually got
// done, so seeing the morning one must not suppress the evening one.
type DigestSlot = "morning" | "evening";

function currentSlot(now: Date = new Date()): DigestSlot {
  return now.getHours() >= DIGEST_EVENING_HOUR ? "evening" : "morning";
}

function slotKey(userId: string, slot: DigestSlot) {
  const date = new Date().toISOString().slice(0, 10);
  return `${STORAGE_PREFIX}.${userId}.${date}.${slot}`;
}

function hasSeenSlot(userId: string, slot: DigestSlot): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(slotKey(userId, slot)) === "1";
}

function markSeenSlot(userId: string, slot: DigestSlot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(slotKey(userId, slot), "1");
}

type VoiceExchange = { question: string; answer: string };

export function DailyDigestDialog({
  open,
  onOpenChange,
  onOpenAssistant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAssistant: () => void;
}) {
  const { profile } = useAuth();
  const { canSpeak, canListen, isSpeaking, isListening, speak, stopSpeaking, listen } = useVoice();
  const [loading, setLoading] = useState(false);
  const [digest, setDigest] = useState<UserDigest | null>(null);
  const [exchanges, setExchanges] = useState<VoiceExchange[]>([]);
  const [askBusy, setAskBusy] = useState(false);

  // The server decides which mode this is (it owns APP_TIMEZONE); the client
  // only reflects it.
  const isEvening = digest?.mode === "evening";

  // First thing a user sees on login: auto-open once per slot per account —
  // once in the morning for the forward-looking briefing, once again after
  // the evening cutoff for the day's wrap-up. Re-opening manually (via the
  // header trigger) is still allowed; this effect only decides whether to
  // open automatically.
  useEffect(() => {
    if (!profile?.id) return;
    if (!hasSeenSlot(profile.id, currentSlot())) {
      onOpenChange(true);
    }
    // Only re-check on account change, not on every onOpenChange identity
    // change from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Fetch fresh digest data every time the dialog opens, whether that was
  // the automatic once-a-day open above or the manual header button.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    getUserDigest()
      .then((result) => {
        if (active) setDigest(result);
      })
      .catch(() => {
        if (active) toast.error("Couldn't load your briefing right now.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      stopSpeaking();
      setExchanges([]);
      // Marks the slot the SERVER decided this digest belongs to, not the
      // browser's own clock — otherwise a user whose machine is in a
      // different timezone from APP_TIMEZONE could dismiss the evening
      // briefing and have it immediately re-open as "the morning one".
      if (profile?.id) markSeenSlot(profile.id, digest?.mode ?? currentSlot());
    }
    onOpenChange(next);
  };

  const handleOpenAssistant = () => {
    handleOpenChange(false);
    onOpenAssistant();
  };

  const handleAsk = async () => {
    if (!canListen || askBusy) return;
    setAskBusy(true);
    try {
      const transcript = await listen();
      if (!transcript.trim()) {
        toast.error("Didn't catch that — try again.");
        return;
      }
      // Threads the running exchange as real conversation history, so a
      // follow-up like "and my tickets?" resolves against what was just
      // asked instead of being treated as a brand-new, context-free turn.
      const history: AssistantChatMessage[] = exchanges.flatMap((exchange) => [
        { role: "user", content: exchange.question },
        { role: "assistant", content: exchange.answer },
      ]);
      const result = await sendAssistantMessage({ message: transcript, history });
      setExchanges((prev) => [...prev, { question: transcript, answer: result.reply }]);
      speak(result.reply);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Voice input failed");
    } finally {
      setAskBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEvening ? <Moon className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {digest?.greeting || "Your briefing"}
          </DialogTitle>
          <DialogDescription>
            {isEvening
              ? "Here's how today went, and what's waiting tomorrow."
              : "Here's what needs your attention today."}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing your briefing…
          </div>
        )}

        {!loading && digest && !digest.available && (
          <p className="text-sm text-muted-foreground">
            A briefing isn't available for your role right now.
          </p>
        )}

        {!loading && !digest && (
          <p className="text-sm text-muted-foreground">Couldn't load your briefing right now.</p>
        )}

        {!loading && digest?.available && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed">{digest.narrative}</p>

            {isEvening && (
              <div className="grid gap-3">
                <DigestSection
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  title="Done today"
                  emptyLabel="No activity logged today."
                  items={digest.completedToday.map((entry) => entry.label)}
                />
                <DigestSection
                  icon={<CalendarClock className="h-3.5 w-3.5" />}
                  title="Tomorrow"
                  emptyLabel="Nothing scheduled to land."
                  items={digest.tomorrow.map(
                    (entry) =>
                      `${entry.title}${
                        entry.reason === "proposed_completion" ? " (proposed completion)" : " (due)"
                      }`,
                  )}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {isEvening && digest.completedToday.length > 0 && (
                <Badge variant="outline">{digest.completedToday.length} logged today</Badge>
              )}
              {!isEvening && digest.pipeline && digest.pipeline.openDealCount > 0 && (
                <Badge variant="outline">
                  {digest.pipeline.openDealCount} open{" "}
                  {digest.pipeline.openDealCount === 1 ? "deal" : "deals"}
                </Badge>
              )}
              {digest.tasks.length > 0 && (
                <Badge variant="outline">
                  {digest.tasks.length} {digest.tasks.length === 1 ? "task" : "tasks"} due soon
                </Badge>
              )}
              {digest.tickets.length > 0 && (
                <Badge variant="outline">
                  {digest.tickets.length} open {digest.tickets.length === 1 ? "ticket" : "tickets"}
                </Badge>
              )}
              {digest.unreadNotificationCount > 0 && (
                <Badge variant="outline">
                  {digest.unreadNotificationCount} unread{" "}
                  {digest.unreadNotificationCount === 1 ? "notification" : "notifications"}
                </Badge>
              )}
              {digest.learning.length > 0 && (
                <Badge variant="outline">
                  {digest.learning.length} {digest.learning.length === 1 ? "track" : "tracks"} in
                  progress
                </Badge>
              )}
            </div>

            {digest.news.length > 0 && (
              <div className="flex flex-col gap-2">
                {digest.news.slice(0, 2).map((post) => (
                  <div key={post.id} className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                    <div className="font-medium">{post.title}</div>
                    <div className="mt-0.5 text-muted-foreground">{post.caption}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canSpeak}
                title={canSpeak ? undefined : "Voice output isn't supported in this browser"}
                onClick={() => (isSpeaking ? stopSpeaking() : speak(digest.narrative))}
              >
                {isSpeaking ? (
                  <Square className="mr-2 h-4 w-4" />
                ) : (
                  <Volume2 className="mr-2 h-4 w-4" />
                )}
                {isSpeaking ? "Stop" : "Tell me"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canListen || askBusy}
                title={canListen ? undefined : "Voice input isn't supported in this browser"}
                onClick={() => void handleAsk()}
              >
                {askBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="mr-2 h-4 w-4" />
                )}
                {askBusy ? (isListening ? "Listening…" : "Thinking…") : "Ask"}
              </Button>
            </div>

            {exchanges.length > 0 && (
              <ScrollArea className="max-h-40 rounded-md border">
                <div className="flex flex-col gap-2 p-2">
                  {exchanges.map((exchange, index) => (
                    <div key={index} className="text-xs">
                      <div className="font-medium">You: {exchange.question}</div>
                      <div className="mt-0.5 text-muted-foreground">{exchange.answer}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={handleOpenAssistant}>
            Open full Assistant
          </Button>
          <Button type="button" size="sm" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A labelled list with an explicit empty state. The empty state matters as
// much as the list here: "Done today — no activity logged" is the thing the
// evening briefing's sarcastic narrative is talking about, so leaving the
// section out entirely would make the joke read as a bug.
function DigestSection({
  icon,
  title,
  items,
  emptyLabel,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {items.slice(0, 6).map((item, index) => (
            <li key={index} className="text-xs leading-relaxed">
              {item}
            </li>
          ))}
          {items.length > 6 && (
            <li className="text-xs text-muted-foreground">+{items.length - 6} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
