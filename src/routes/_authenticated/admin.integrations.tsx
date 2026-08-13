import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Link as LinkIcon,
  Mail,
  MessageSquare,
  Package,
  Pause,
  PauseCircle,
  Play,
  RefreshCw,
  Settings,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  component: AdminIntegrationsPage,
});

type ConnectionState = "connected" | "attention_needed" | "paused" | "disconnected";

type ProviderData = {
  id: string;
  name: string;
  category: string;
  icon: React.ElementType;
  state: ConnectionState;
  environment: "production" | "sandbox";
  lastOutbound: string | null;
  lastInbound: string | null;
  queueDepth: number;
  deadLetterCount: number;
  conflicts: number;
};

const INITIAL_PROVIDERS: ProviderData[] = [
  {
    id: "zoho_books",
    name: "Zoho Books",
    category: "Accounting & ERP",
    icon: Database,
    state: "connected",
    environment: "production",
    lastOutbound: "2 mins ago",
    lastInbound: "1 hr ago",
    queueDepth: 0,
    deadLetterCount: 0,
    conflicts: 2,
  },
  {
    id: "zoho_sign",
    name: "Zoho Sign",
    category: "Agreement Execution",
    icon: LinkIcon,
    state: "connected",
    environment: "production",
    lastOutbound: "10 mins ago",
    lastInbound: "Just now",
    queueDepth: 0,
    deadLetterCount: 0,
    conflicts: 0,
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    category: "Messaging",
    icon: MessageSquare,
    state: "attention_needed",
    environment: "production",
    lastOutbound: "4 hrs ago",
    lastInbound: "4 hrs ago",
    queueDepth: 45,
    deadLetterCount: 12,
    conflicts: 0,
  },
  {
    id: "email",
    name: "Postmark Email",
    category: "Delivery",
    icon: Mail,
    state: "connected",
    environment: "production",
    lastOutbound: "Just now",
    lastInbound: "5 mins ago",
    queueDepth: 2,
    deadLetterCount: 0,
    conflicts: 0,
  },
  // GyFTR (rewards fulfilment) and DHL Express (logistics) are deliberately
  // absent. Both are placeholders on the backend only — src/integrations/gyftr
  // exists and returns a stub voucher response when unconfigured — and product
  // direction is that neither is surfaced to operators until it is really
  // wired. Showing a "paused" GyFTR row with a queue depth of 180 implied a
  // live integration that does not exist. Do not re-add without a real
  // connection behind it.
];

function StateBadge({ state }: { state: ConnectionState }) {
  switch (state) {
    case "connected":
      return (
        <Badge tone="success">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Connected
        </Badge>
      );
    case "attention_needed":
      return (
        <Badge tone="danger">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Attention Needed
        </Badge>
      );
    case "paused":
      return (
        <Badge tone="warning">
          <PauseCircle className="mr-1 h-3 w-3" />
          Paused
        </Badge>
      );
    case "disconnected":
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          <Unplug className="mr-1 h-3 w-3" />
          Disconnected
        </Badge>
      );
  }
}

function AdminIntegrationsPage() {
  const { hasRole } = useAuth();
  const [providers, setProviders] = useState<ProviderData[]>(INITIAL_PROVIDERS);
  const [processingId, setProcessingId] = useState<string | null>(null);

  if (!hasRole("super_admin")) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
        <AlertTriangle className="h-8 w-8 text-warning" />
        <p>You must be a Super Admin to view the Integration Operations Centre.</p>
      </div>
    );
  }

  const handleAction = async (
    id: string,
    action: "pause" | "resume" | "disconnect" | "reconnect",
  ) => {
    setProcessingId(id);
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    setProviders((current) =>
      current.map((p) => {
        if (p.id !== id) return p;

        switch (action) {
          case "pause":
            toast.info(`${p.name} outbound processing paused`);
            return { ...p, state: "paused" };
          case "resume":
            if (p.state === "attention_needed") {
              toast.error(`Cannot resume ${p.name}. Resolve health issues first.`);
              return p;
            }
            toast.success(`${p.name} processing resumed`);
            return { ...p, state: "connected" };
          case "disconnect":
            toast.info(`${p.name} disconnected`);
            return { ...p, state: "disconnected" };
          case "reconnect":
            toast.success(`${p.name} verified and connected`);
            return { ...p, state: "connected" };
        }
      }),
    );
    setProcessingId(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations Centre"
        icon={<Activity className="h-3.5 w-3.5" />}
        title="External Integrations"
        description="Monitor and control durable provider adapters. Never share secrets or leak payloads."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => {
          const Icon = provider.icon;
          const isProcessing = processingId === provider.id;

          return (
            <Card key={provider.id} className="flex flex-col">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-muted p-2">
                      <Icon className="h-5 w-5 text-foreground" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{provider.name}</CardTitle>
                      <CardDescription className="text-xs">{provider.category}</CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">
                    {provider.environment}
                  </Badge>
                </div>
                <div className="mt-4">
                  <StateBadge state={provider.state} />
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <div className="text-muted-foreground text-xs">Last Outbound</div>
                    <div className="font-medium">{provider.lastOutbound || "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Last Webhook</div>
                    <div className="font-medium">{provider.lastInbound || "—"}</div>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-2xl font-semibold">{provider.queueDepth}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Queued
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-2xl font-semibold ${provider.deadLetterCount > 0 ? "text-destructive" : ""}`}
                      >
                        {provider.deadLetterCount}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Failed
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-2xl font-semibold ${provider.conflicts > 0 ? "text-warning" : ""}`}
                      >
                        {provider.conflicts}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Conflicts
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="border-t bg-muted/10 px-6 py-4">
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    {provider.state === "connected" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isProcessing}
                        onClick={() => void handleAction(provider.id, "pause")}
                      >
                        <Pause className="mr-1.5 h-3.5 w-3.5" />
                        Pause
                      </Button>
                    )}
                    {(provider.state === "paused" || provider.state === "attention_needed") && (
                      <Button
                        size="sm"
                        disabled={isProcessing}
                        onClick={() => void handleAction(provider.id, "resume")}
                      >
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                        Resume
                      </Button>
                    )}
                    {provider.state === "disconnected" && (
                      <Button
                        size="sm"
                        disabled={isProcessing}
                        onClick={() => void handleAction(provider.id, "reconnect")}
                      >
                        <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
                        Connect
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button size="icon" variant="ghost" title="Settings">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    {provider.state !== "disconnected" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Disconnect"
                        disabled={isProcessing}
                        onClick={() => void handleAction(provider.id, "disconnect")}
                      >
                        <Unplug className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
