import { useCallback, useEffect, useRef, useState } from "react";
import { Call, Device } from "@twilio/voice-sdk";
import { Loader2, Mic, MicOff, Phone, PhoneCall, PhoneIncoming, PhoneOff } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  mintVoiceAccessToken,
  setCallDisposition,
  setCallReady,
} from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";

const CALL_DISPOSITIONS = [
  "Resolved",
  "Follow-up needed",
  "Escalated",
  "No answer / voicemail",
  "Wrong number",
  "Other",
];

type Phase = "idle" | "incoming" | "connecting" | "active" | "wrapup";

function readCallSid(call: Call | null): string | null {
  if (!call) return null;
  return call.parameters?.CallSid || call.outboundConnectionId || null;
}

// Global softphone panel — mounted in app-shell.tsx only for callers with
// the "calls" capability (unlike AssistantPanel, which is unconditional).
// Follows the same Sheet-based slide-over / local-state structure as
// assistant-panel.tsx, but drives actual calling through @twilio/voice-sdk's
// Device instead of request/response server-fn calls.
export function SoftphonePanel() {
  const { profile, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [callReady, setCallReadyState] = useState(false);
  const [togglingReady, setTogglingReady] = useState(false);
  const [dialValue, setDialValue] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [incomingFrom, setIncomingFrom] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [pendingCallSid, setPendingCallSid] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<string>(CALL_DISPOSITIONS[0]);
  const [savingDisposition, setSavingDisposition] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const deviceRef = useRef<Device | null>(null);
  const activeCallRef = useRef<Call | null>(null);

  useEffect(() => {
    setCallReadyState(profile?.call_ready ?? false);
  }, [profile?.call_ready]);

  const wireCallEvents = useCallback((call: Call, direction: "incoming" | "outgoing") => {
    activeCallRef.current = call;

    call.on("accept", () => {
      setPhase("active");
      setMuted(false);
    });

    call.on("disconnect", () => {
      const sid = readCallSid(call);
      activeCallRef.current = null;
      setIncomingFrom(null);
      if (sid) {
        setPendingCallSid(sid);
        setDisposition(CALL_DISPOSITIONS[0]);
        setPhase("wrapup");
      } else {
        setPhase("idle");
      }
    });

    call.on("cancel", () => {
      // Caller hung up before any agent answered — nothing this agent
      // handled, so no disposition prompt (another on-duty agent may still
      // be ringing, or the caller simply gave up).
      activeCallRef.current = null;
      setIncomingFrom(null);
      setPhase("idle");
    });

    call.on("reject", () => {
      activeCallRef.current = null;
      setIncomingFrom(null);
      setPhase("idle");
    });

    call.on("error", (error) => {
      console.error("[Softphone] call error:", error);
      toast.error(error?.message || "Call error");
      activeCallRef.current = null;
      setPhase("idle");
    });

    if (direction === "outgoing") {
      setPhase("connecting");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function setupDevice() {
      try {
        const { token } = await mintVoiceAccessToken();
        if (cancelled) return;

        const device = new Device(token, { logLevel: "error" });
        deviceRef.current = device;

        device.on("registered", () => {
          if (!cancelled) {
            setDeviceReady(true);
            setDeviceError(null);
          }
        });
        device.on("unregistered", () => {
          if (!cancelled) setDeviceReady(false);
        });
        device.on("error", (error) => {
          console.error("[Softphone] device error:", error);
          if (!cancelled) setDeviceError(error?.message || "Softphone connection error");
        });
        device.on("tokenWillExpire", async () => {
          try {
            const refreshed = await mintVoiceAccessToken();
            device.updateToken(refreshed.token);
          } catch (error) {
            console.error("[Softphone] failed to refresh voice token:", error);
          }
        });
        device.on("incoming", (call: Call) => {
          wireCallEvents(call, "incoming");
          setIncomingFrom(call.parameters?.From || "Unknown number");
          setPhase("incoming");
        });

        await device.register();
      } catch (error) {
        console.error("[Softphone] failed to set up device:", error);
        if (!cancelled) {
          setDeviceError(error instanceof Error ? error.message : "Failed to set up softphone");
        }
      }
    }

    void setupDevice();

    return () => {
      cancelled = true;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleReady = async (next: boolean) => {
    setTogglingReady(true);
    try {
      await setCallReady({ ready: next });
      setCallReadyState(next);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update ready status");
    } finally {
      setTogglingReady(false);
    }
  };

  const placeCall = async () => {
    const to = dialValue.trim();
    if (!to || !deviceRef.current) return;
    setConnecting(true);
    try {
      const call = await deviceRef.current.connect({ params: { To: to } });
      wireCallEvents(call, "outgoing");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to place call");
    } finally {
      setConnecting(false);
    }
  };

  const acceptIncoming = () => {
    activeCallRef.current?.accept();
  };

  const declineIncoming = () => {
    activeCallRef.current?.reject();
    setPhase("idle");
    setIncomingFrom(null);
  };

  const hangUp = () => {
    activeCallRef.current?.disconnect();
  };

  const toggleMute = () => {
    const next = !muted;
    activeCallRef.current?.mute(next);
    setMuted(next);
  };

  const saveDisposition = async () => {
    if (!pendingCallSid) return;
    setSavingDisposition(true);
    try {
      await setCallDisposition({ twilioCallSid: pendingCallSid, disposition });
      toast.success("Call logged");
      setPendingCallSid(null);
      setPhase("idle");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save disposition");
    } finally {
      setSavingDisposition(false);
    }
  };

  const skipDisposition = () => {
    setPendingCallSid(null);
    setPhase("idle");
  };

  const hasIncoming = phase === "incoming";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Open Softphone"
          className={`gap-2 border ${
            hasIncoming
              ? "animate-pulse border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15"
          }`}
        >
          {hasIncoming ? <PhoneIncoming className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
          {/* Label collapses on phones — an incoming call still reads clearly
              from the pulsing destructive-tinted icon alone. */}
          <span className="hidden 2xl:inline">{hasIncoming ? "Incoming call" : "Softphone"}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4" /> Softphone
          </SheetTitle>
          <SheetDescription>
            {deviceError
              ? deviceError
              : deviceReady
                ? "Connected to LIVEY Voice."
                : "Connecting to LIVEY Voice…"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Ready for calls</span>
            <span className="text-xs text-muted-foreground">
              {callReady ? "You'll be rung on inbound calls" : "You're marked not ready"}
            </span>
          </div>
          <Switch
            checked={callReady}
            disabled={togglingReady}
            onCheckedChange={(checked) => void toggleReady(checked)}
          />
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {phase === "incoming" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <PhoneIncoming className="h-4 w-4" /> Incoming call
              </div>
              <div className="mt-1 text-lg font-semibold">{incomingFrom}</div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={acceptIncoming} className="flex-1">
                  Accept
                </Button>
                <Button size="sm" variant="outline" onClick={declineIncoming} className="flex-1">
                  Decline
                </Button>
              </div>
            </div>
          )}

          {(phase === "active" || phase === "connecting") && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                {phase === "connecting" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
                  </>
                ) : (
                  <>
                    <PhoneCall className="h-4 w-4 text-primary" /> In call
                    {incomingFrom ? ` with ${incomingFrom}` : dialValue ? ` with ${dialValue}` : ""}
                  </>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant={muted ? "default" : "outline"}
                  onClick={toggleMute}
                  className="flex-1 gap-2"
                >
                  {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {muted ? "Unmute" : "Mute"}
                </Button>
                <Button size="sm" variant="destructive" onClick={hangUp} className="flex-1 gap-2">
                  <PhoneOff className="h-4 w-4" /> Hang up
                </Button>
              </div>
            </div>
          )}

          {phase === "wrapup" && (
            <div className="rounded-lg border p-4">
              <div className="text-sm font-medium">How did that call go?</div>
              <div className="mt-3 space-y-3">
                <Select value={disposition} onValueChange={setDisposition}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a disposition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_DISPOSITIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void saveDisposition()}
                    disabled={savingDisposition}
                    className="flex-1"
                  >
                    {savingDisposition ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={skipDisposition}>
                    Skip
                  </Button>
                </div>
              </div>
            </div>
          )}

          {phase === "idle" && (
            <div className="space-y-3">
              <Label htmlFor="softphone-dial">Dial a number</Label>
              <Input
                id="softphone-dial"
                value={dialValue}
                onChange={(event) => setDialValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void placeCall();
                  }
                }}
                placeholder="+14155552671"
              />
              <Button
                className="w-full gap-2"
                disabled={!deviceReady || !dialValue.trim() || connecting}
                onClick={() => void placeCall()}
              >
                {connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Phone className="h-4 w-4" />
                )}
                Call
              </Button>
              {!deviceReady && !deviceError && (
                <Badge variant="outline" className="w-fit">
                  Connecting to LIVEY Voice…
                </Badge>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
