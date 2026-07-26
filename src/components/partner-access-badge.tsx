// src/components/partner-access-badge.tsx
import { Badge } from "@/components/ui/badge";
import { 
  ShieldCheck, 
  Lock, 
  AlertCircle, 
  Clock, 
  FileSignature 
} from "lucide-react";
import { getStatusLabel } from "@/lib/partner-status";

interface PartnerAccessBadgeProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

export function PartnerAccessBadge({ status, size = 'md' }: PartnerAccessBadgeProps) {
  const configs: Record<string, { icon: React.ComponentType; variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
    pending_partner_registration: { icon: Lock, variant: 'secondary', label: 'Registration Required' },
    submitted: { icon: Clock, variant: 'outline', label: 'Submitted' },
    under_review: { icon: Clock, variant: 'outline', label: 'Under Review' },
    partial_approval: { icon: ShieldCheck, variant: 'default', label: 'Partial Access' },
    pending_agreement: { icon: FileSignature, variant: 'default', label: 'Agreement Pending' },
    approved: { icon: ShieldCheck, variant: 'default', label: 'Full Access' },
    rejected: { icon: AlertCircle, variant: 'destructive', label: 'Rejected' },
    need_more_info: { icon: AlertCircle, variant: 'outline', label: 'More Info Needed' },
  };
  
  const config = configs[status] ?? { icon: Lock, variant: 'secondary', label: status };
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
    lg: 'text-sm px-3 py-1',
  };
  
  return (
    <Badge variant={config.variant} className={`gap-1 ${sizeClasses[size]}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}