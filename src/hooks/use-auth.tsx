import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, type Session, type User } from "@/integrations/local/client";
import type { PartnerStatus } from "@/lib/partner-status";

export type AppRole = "super_admin" | "partner_admin" | "partner_user";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  avatar_url: string | null;
  partner_id: string | null;
  partner_status: PartnerStatus;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  hasRole: (role: AppRole) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const [{ data: prof }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setProfile((prof as Profile | null) ?? null);
    setRoles(((roleRows ?? []) as { role: AppRole }[]).map((r) => r.role));
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
    loading,
    hasRole: (r) => roles.includes(r),
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
