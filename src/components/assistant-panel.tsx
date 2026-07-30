import { useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { AssistantDealDraft, AssistantDealSummary } from "@/domain/contracts/assistant";
import { confirmAssistantDeal, sendAssistantMessage } from "@/integrations/local/assistant";

type PanelMessage = {
  role: "user" | "assistant";
  content: string;
  deals?: AssistantDealSummary[];
};

const WELCOME_MESSAGE: PanelMessage = {
  role: "assistant",
  content:
    "Hi, I'm the LIVEY Assistant. I can create a new deal from what you tell me, or answer questions about your existing deals — that's all I do here.",
};

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PanelMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<AssistantDealDraft | null>(null);
  const [confirming, setConfirming] = useState(false);

  const send = async () => {
    const message = input.trim();
    if (!message || sending) return;

    setSending(true);
    setInput("");
    setPendingDraft(null);
    const nextMessages: PanelMessage[] = [...messages, { role: "user", content: message }];
    setMessages(nextMessages);

    try {
      const result = await sendAssistantMessage({
        conversationId,
        message,
        history: messages.map((entry) => ({ role: entry.role, content: entry.content })),
      });
      setConversationId(result.conversationId);
      setMessages([
        ...nextMessages,
        { role: "assistant", content: result.reply, deals: result.deals },
      ]);
      if (result.requiresConfirmation && result.draft) {
        setPendingDraft(result.draft);
      }
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? `Something went wrong: ${error.message}`
              : "Something went wrong reaching the assistant.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const confirmDeal = async () => {
    if (!pendingDraft || !conversationId || confirming) return;
    setConfirming(true);
    try {
      const { reply, result } = await confirmAssistantDeal({
        conversationId,
        draft: pendingDraft,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      setPendingDraft(null);
      if (result.ok) {
        toast.success("Deal created");
      } else {
        toast.error(result.failure.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create the deal");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Open LIVEY Assistant"
          className="gap-2 border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15"
        >
          <Sparkles className="h-4 w-4" />
          Assistant
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" /> Assistant
          </SheetTitle>
          <SheetDescription>Create a deal or ask about your existing deals.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4 py-3">
          <div className="flex flex-col gap-3">
            {messages.map((entry, index) => (
              <div
                key={index}
                className={
                  entry.role === "user"
                    ? "ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "mr-8 rounded-lg border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {entry.content}
                {entry.deals && entry.deals.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {entry.deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-md border bg-background px-2 py-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{deal.accountName}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {deal.stage}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          {deal.product} · {deal.currencyCode} {deal.amount}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="mr-8 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
          </div>
        </ScrollArea>

        {pendingDraft && (
          <div className="border-t bg-muted/30 px-4 py-3">
            <Button
              type="button"
              className="w-full"
              disabled={confirming}
              onClick={() => void confirmDeal()}
            >
              {confirming ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Confirm & create deal
            </Button>
          </div>
        )}

        <div className="flex items-end gap-2 border-t px-4 py-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="e.g. Create a deal for Acme Corp, 10 units of WC350, $4,200"
            className="min-h-10 flex-1 resize-none"
            rows={1}
          />
          <Button
            type="button"
            size="icon"
            disabled={sending || !input.trim()}
            onClick={() => void send()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
