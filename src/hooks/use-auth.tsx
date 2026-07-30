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
    const typedAssignments = ((assignmentRows ?? []) as AssignmentRecord[]) ?? [];
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
