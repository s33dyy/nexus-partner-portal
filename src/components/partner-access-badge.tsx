// src/components/partner-access-badge.tsx
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Lock, AlertCircle, Clock, FileSignature } from "lucide-react";

interface PartnerAccessBadgeProps {
  status: string;
  size?: "sm" | "md" | "lg";
}

export function PartnerAccessBadge({ status, size = "md" }: PartnerAccessBadgeProps) {
  type Tone = "neutral" | "brand" | "success" | "warning" | "info" | "danger";
  const configs: Record<
    string,
    { icon: React.ComponentType<{ className?: string }>; tone: Tone; label: string }
  > = {
    pending_partner_registration: { icon: Lock, tone: "neutral", label: "Registration Required" },
    submitted: { icon: Clock, tone: "info", label: "Submitted" },
    under_review: { icon: Clock, tone: "info", label: "Under Review" },
    partial_approval: { icon: ShieldCheck, tone: "warning", label: "Basic Access" },
    pending_agreement: { icon: FileSignature, tone: "warning", label: "Basic Access" },
    signed_pending_review: { icon: FileSignature, tone: "warning", label: "Basic Access" },
    approved: { icon: ShieldCheck, tone: "success", label: "Full Access" },
    rejected: { icon: AlertCircle, tone: "danger", label: "Rejected" },
    need_more_info: { icon: AlertCircle, tone: "warning", label: "More Info Needed" },
  };

  const config = configs[status] ?? { icon: Lock, tone: "neutral" as Tone, label: status };
  const Icon = config.icon;

  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-0.5",
    lg: "text-sm px-3 py-1",
  };

  return (
    <Badge tone={config.tone} className={`gap-1 ${sizeClasses[size]}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
