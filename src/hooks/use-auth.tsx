/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, type Session, type User } from "@/integrations/local/client";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { CrudOperation, FeatureKey } from "@/domain/contracts/features";
import type { RoleKey } from "@/domain/contracts/taxonomy";
import { getMyCapabilities } from "@/integrations/local/role-permission-commands";
import type { PartnerStatus } from "@/lib/partner-status";

type FeatureCapabilities = Record<FeatureKey, Record<CrudOperation, boolean>>;

export type AppRole = RoleKey;

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  avatar_url: string | null;
  partner_id: string | null;
  partner_status: PartnerStatus;
  must_reset_password: boolean;
  google_id: string | null;
  google_email: string | null;
  google_linked_at: string | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  roleKey: RoleKey | null;
  assignment: AssignmentRecord | null;
  activeContext: ActiveContextRecord | null;
  loading: boolean;
  hasRole: (role: AppRole) => boolean;
  can: (featureKey: FeatureKey, operation: CrudOperation) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// supabase.from("assignments").select("*") returns the raw Postgres row —
// snake_case columns (role_key, geography_ceiling_node_id, ...) — but
// AssignmentRecord is camelCase. A bare `as AssignmentRecord` cast (no
// runtime mapping) left every compound-word field silently undefined:
// roleKey, geographyCeilingNodeId, partnerId, isSeed, etc. Single-word
// fields like status/version happened to match either way, which is why
// this went unnoticed — anything gating on assignment.roleKey (this file's
// own roleKey export, app-shell's role label, every LIVEY-internal-role
// scope-bypass check added this session) silently saw `undefined` instead
// of e.g. "rm", collapsing straight to the most restrictive branch.
function mapAssignmentRow(row: Record<string, unknown>): AssignmentRecord {
  return {
    assignmentId: String(row.assignment_id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    organizationTenantId: String(row.organization_tenant_id),
    roleKey: row.role_key as AssignmentRecord["roleKey"],
    teamDomain: row.team_domain as AssignmentRecord["teamDomain"],
    geographyCeilingNodeId: String(row.geography_ceiling_node_id),
    partnerId: row.partner_id == null ? null : String(row.partner_id),
    accountId: row.account_id == null ? null : String(row.account_id),
    portfolioId: row.portfolio_id == null ? null : String(row.portfolio_id),
    queueId: row.queue_id == null ? null : String(row.queue_id),
    status: row.status as AssignmentRecord["status"],
    validFrom: String(row.valid_from),
    validTo: row.valid_to == null ? null : String(row.valid_to),
    managerAssignmentId:
      row.manager_assignment_id == null ? null : String(row.manager_assignment_id),
    source: String(row.source),
    approverUserId: row.approver_user_id == null ? null : String(row.approver_user_id),
    predecessorAssignmentId:
      row.predecessor_assignment_id == null ? null : String(row.predecessor_assignment_id),
    successorAssignmentId:
      row.successor_assignment_id == null ? null : String(row.successor_assignment_id),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    revocationReason: row.revocation_reason == null ? null : String(row.revocation_reason),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
    isSeed: Boolean(row.is_seed),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [assignment, setAssignment] = useState<AssignmentRecord | null>(null);
  const [activeContext, setActiveContext] = useState<ActiveContextRecord | null>(null);
  const [capabilities, setCapabilities] = useState<FeatureCapabilities | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const [
      { data: prof },
      { data: roleRows },
      { data: assignmentRows },
      { data: contextRows },
      myCapabilities,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("assignments")
        .select("*")
        .eq("user_id", userId)
        .order("valid_from", { ascending: false }),
      supabase
        .from("active_contexts")
        .select("*")
        .eq("user_id", userId)
        .order("issued_at", { ascending: false })
        .maybeSingle(),
      getMyCapabilities().catch(() => null),
    ]);
    setProfile((prof as Profile | null) ?? null);
    const typedAssignments = ((assignmentRows ?? []) as Record<string, unknown>[]).map(
      mapAssignmentRow,
    );
    setRoles(((roleRows ?? []) as { role: AppRole }[]).map((r) => r.role));
    const assignmentRow = typedAssignments[0] ?? null;
    setAssignment(assignmentRow);
    setCapabilities(myCapabilities);
    const contextRow = (contextRows as Record<string, unknown> | null) ?? null;
    if (contextRow && assignmentRow) {
      setActiveContext({
        contextId: String(contextRow.context_id),
        userId: String(contextRow.user_id),
        assignmentId: String(contextRow.assignment_id),
        assignmentStatus: assignmentRow.status,
        tenantId: String(contextRow.tenant_id),
        organizationTenantId: String(contextRow.organization_tenant_id),
        workingScope: contextRow.working_scope == null ? null : String(contextRow.working_scope),
        issuedAt: String(contextRow.issued_at),
        expiresAt: String(contextRow.expires_at),
        version: Number(contextRow.version),
        revocationLink:
          contextRow.revocation_link == null ? null : String(contextRow.revocation_link),
        correlationId: String(contextRow.correlation_id),
        assignmentVersion: assignmentRow.version,
        workingScopeNodeId:
          contextRow.working_scope == null ? null : String(contextRow.working_scope),
        revokedAt: contextRow.revoked_at == null ? null : String(contextRow.revoked_at),
        revocationReason:
          contextRow.revocation_reason == null ? null : String(contextRow.revocation_reason),
        isSeed: Boolean(contextRow.is_seed ?? assignmentRow.isSeed),
        createdAt: String(contextRow.created_at),
        updatedAt: String(contextRow.updated_at),
      });
    } else {
      setActiveContext(null);
    }
  };

  useEffect(() => {
    // Set up listener FIRST (guidance: onAuthStateChange must be registered before getSession)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        // defer supabase call to avoid deadlock
        setTimeout(() => void loadProfile(s.user.id), 0);
      } else {
        setProfile(null);
        setRoles([]);
        setAssignment(null);
        setActiveContext(null);
        setCapabilities(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        void loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    profile,
    roles,
    roleKey: assignment?.roleKey ?? null,
    assignment,
    activeContext,
    loading,
    hasRole: (r) => roles.includes(r),
    can: (featureKey, operation) => capabilities?.[featureKey]?.[operation] ?? false,
    refresh: async () => {
      if (session?.user) await loadProfile(session.user.id);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
