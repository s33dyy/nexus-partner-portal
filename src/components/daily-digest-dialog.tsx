import { useEffect, useState } from "react";
import { Loader2, Mic, Sparkles, Square, Volume2 } from "lucide-react";
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
import type { UserDigest } from "@/domain/contracts/digest";
import { useAuth } from "@/hooks/use-auth";
import { useVoice } from "@/hooks/use-voice";
import { sendAssistantMessage } from "@/integrations/local/assistant";
import { getUserDigest } from "@/integrations/local/digest";

const STORAGE_PREFIX = "livey.digest-seen";

function todayKey(userId: string) {
  const date = new Date().toISOString().slice(0, 10);
  return `${STORAGE_PREFIX}.${userId}.${date}`;
}

function hasSeenToday(userId: string): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(todayKey(userId)) === "1";
}

function markSeenToday(userId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(todayKey(userId), "1");
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

  // First thing a user sees on login: auto-open once per day per account.
  // Re-opening later the same day (via the header's manual trigger) is
  // still allowed — this effect only decides whether to open automatically.
  useEffect(() => {
    if (!profile?.id) return;
    if (!hasSeenToday(profile.id)) {
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
      if (profile?.id) markSeenToday(profile.id);
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
      const result = await sendAssistantMessage({ message: transcript, history: [] });
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
            <Sparkles className="h-4 w-4" />
            {digest?.greeting || "Your briefing"}
          </DialogTitle>
          <DialogDescription>Here's what needs your attention today.</DialogDescription>
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

            <div className="flex flex-wrap gap-2">
              {digest.pipeline && digest.pipeline.openDealCount > 0 && (
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
              {digest.openTicketCount ? (
                <Badge variant="outline">
                  {digest.openTicketCount} open{" "}
                  {digest.openTicketCount === 1 ? "ticket" : "tickets"}
                </Badge>
              ) : null}
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

            {digest.news[0] && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <div className="font-medium">{digest.news[0].title}</div>
                <div className="mt-0.5 text-muted-foreground">{digest.news[0].caption}</div>
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
