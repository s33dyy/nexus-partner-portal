import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Sparkles, ShieldCheck, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/local/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { BrandLogo } from "@/components/brand-logo";

const authSearchSchema = z.object({
  mode: z.enum(["signin", "signup", "forgot"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: authSearchSchema,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [tab, setTab] = useState<string>(search.mode ?? "signin");

  useEffect(() => {
    setTab(search.mode ?? "signin");
  }, [search.mode]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: search.redirect ?? "/dashboard", replace: true });
    });
  }, [navigate, search.redirect]);

  return (
    <div className="grid min-h-dvh overflow-x-hidden lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground">
        <div className="absolute inset-0 opacity-40 [background:radial-gradient(1200px_600px_at_10%_-20%,color-mix(in_oklab,var(--sidebar-primary)_30%,transparent),transparent),radial-gradient(800px_400px_at_100%_100%,color-mix(in_oklab,var(--sidebar-primary)_20%,transparent),transparent)]" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 items-center justify-center rounded-xl bg-sidebar-primary/10 px-3 py-2 ring-1 ring-sidebar-border/50">
            <BrandLogo variant="wordmark" className="h-7 w-auto object-contain" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
              Partner Portal
            </span>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="text-4xl font-semibold leading-tight">
            Grow with LIVEY.
            <br />
            One partnership, endless opportunities.
          </h1>
          <p className="max-w-md text-sm text-sidebar-foreground/70">
            Register deals, manage your pipeline, unlock tier benefits, and collaborate with the
            LIVEY team — all from a single enterprise-grade workspace.
          </p>
          <div className="grid gap-3 text-sm">
            <Feature
              icon={ShieldCheck}
              title="Client-lock protection"
              text="No double-selling — reserved customers stay yours."
            />
            <Feature
              icon={TrendingUp}
              title="Tiered rewards"
              text="Silver, Gold, Platinum — earn deeper margins as you grow."
            />
            <Feature
              icon={Sparkles}
              title="Deal registration"
              text="Standard and strategic deals, approved fast."
            />
          </div>
        </div>

        <div className="relative text-xs text-sidebar-foreground/60">
          © {new Date().getFullYear()} LIVEY Technologies. All rights reserved.
        </div>
      </div>

      {/* Form panel */}
      <div className="flex min-w-0 items-center justify-center bg-background p-6 md:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden flex items-center gap-2">
            <div className="flex h-10 items-center justify-center rounded-lg bg-primary/10 px-2.5 py-1.5 ring-1 ring-border">
              <BrandLogo variant="wordmark" className="h-6 w-auto object-contain" />
            </div>
            <span className="text-sm font-semibold">Partner Portal</span>
          </div>
          {tab === "forgot" ? (
            <ForgotForm />
          ) : (
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Register</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" className="mt-6">
                <SignInForm redirect={search.redirect} />
              </TabsContent>
              <TabsContent value="signup" className="mt-6">
                <SignUpForm />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <Card className="border-sidebar-border/40 bg-sidebar-accent/40 text-sidebar-foreground">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-md bg-sidebar-primary/20 p-2 text-sidebar-primary-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-sidebar-foreground/70">{text}</div>
        </div>
      </CardContent>
    </Card>
  );
}

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(128),
});

function SignInForm({ redirect }: { redirect?: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signInSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Welcome back");
    navigate({ to: redirect ?? "/dashboard", replace: true });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h2>
        <p className="text-sm text-muted-foreground">
          Enter your credentials to access the LIVEY Partner Portal.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <Link
          to="/auth"
          search={{ mode: "forgot" }}
          className="font-medium text-primary hover:underline"
        >
          Forgot password?
        </Link>
      </p>
      <p className="text-center text-xs text-muted-foreground">
        New to LIVEY?{" "}
        <Link
          to="/auth"
          search={{ mode: "signup" }}
          className="font-medium text-primary hover:underline"
        >
          Create a partner account
        </Link>
      </p>
    </form>
  );
}

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  phone: z.string().trim().min(6, "Enter a valid phone").max(30),
  company_name: z.string().trim().min(2, "Company name is required").max(160),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

function SignUpForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    company_name: "",
    password: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signUpSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/partner/onboarding`,
        data: {
          full_name: parsed.data.full_name,
          phone: parsed.data.phone,
          company_name: parsed.data.company_name,
        },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Partner admin account created — continuing to onboarding.");
    navigate({ to: "/partner/onboarding", replace: true });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Register a partner admin account</h2>
        <p className="text-sm text-muted-foreground">
          Step 1 of 2. Partner admins complete company verification in the onboarding form after
          sign-in.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="full_name">Full name</Label>
          <Input
            id="full_name"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label htmlFor="company_name">Company name</Label>
          <Input
            id="company_name"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            required
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <p className="text-xs text-muted-foreground">
            Minimum 8 characters. We check against known breached passwords.
          </p>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Create account
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        By registering, you agree to LIVEY's Partner Terms of Service.
      </p>
    </form>
  );
}

function ForgotForm() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = z.string().trim().email().safeParse(email);
    if (!parsed.success) {
      toast.error("Enter a valid email");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.resetLink) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.resetLink).catch(() => undefined);
      }
      toast.success("Reset link generated and copied to clipboard.");
    } else {
      toast.success("If that account exists, a reset link is on its way.");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Recover account</h2>
        <p className="text-sm text-muted-foreground">
          We'll email you a secure link to set a new password.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="fpemail">Email</Label>
        <Input
          id="fpemail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Send reset link
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <Link
          to="/auth"
          search={{ mode: "signin" }}
          className="font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
