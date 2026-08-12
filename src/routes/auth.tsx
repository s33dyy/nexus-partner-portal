import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Sparkles, ShieldCheck, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/local/client";
import { requestSignupOtp, signUpVerified } from "@/integrations/local/signup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { BrandLogo } from "@/components/brand-logo";

const authSearchSchema = z.object({
  mode: z.enum(["signin", "signup", "forgot"]).optional(),
  redirect: z.string().optional(),
  googleError: z.string().optional(),
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

  useEffect(() => {
    if (search.googleError) {
      toast.error(`Google sign-in failed: ${search.googleError}`);
      window.history.replaceState(null, "", "/auth");
    }
  }, [search.googleError]);

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
      <div className="flex min-w-0 items-center justify-center bg-card p-6 md:p-10">
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
            <>
              <GoogleContinueButton />
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>or continue with email</span>
                <div className="h-px flex-1 bg-border" />
              </div>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Full-page redirect to the OAuth flow (src/server/google-oauth.server.ts,
// intercepted in src/server.ts) — a plain link, not a client-side auth call,
// same pattern as the "Connect Zoho Sign" button in settings.tsx. Works for
// both login (existing account) and signup (brand-new account); which one
// happens is decided server-side once Google's identity comes back.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

function GoogleContinueButton() {
  return (
    <Button type="button" variant="outline" className="w-full gap-2" asChild>
      <a href="/api/auth/google/connect">
        <GoogleIcon className="h-4 w-4" />
        Continue with Google
      </a>
    </Button>
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
  // E.164, because the number is now verified by SMS and later used to send
  // WhatsApp reminders — a local-format number can't be dialled by either.
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Enter your phone in international format, e.g. +919876543210")
    .max(20),
  company_name: z.string().trim().min(2, "Company name is required").max(160),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const OTP_LENGTH = 6;

function SignUpForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"details" | "verify">("details");
  const [code, setCode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    company_name: "",
    password: "",
  });

  // Counts down the resend button. Purely cosmetic pacing — the real limit is
  // enforced server-side (3 sends per number per 15 minutes) and by Twilio.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const createAccount = async (verificationCode: string | null) => {
    await signUpVerified({
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company_name: form.company_name.trim(),
      password: form.password,
      code: verificationCode,
    });
    toast.success("Partner admin account created — continuing to onboarding.");
    navigate({ to: "/partner/onboarding", replace: true });
  };

  const submitDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signUpSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      const result = await requestSignupOtp({
        email: parsed.data.email,
        phoneE164: parsed.data.phone,
      });
      if (!result.required) {
        // Twilio Verify isn't configured in this environment, so there is no
        // code to wait for — the account is created in one step instead of
        // blocking registration behind an OTP that can never arrive.
        await createAccount(null);
        return;
      }
      setStep("verify");
      setCode("");
      setResendCooldown(30);
      toast.success(`We sent a ${OTP_LENGTH}-digit code to ${parsed.data.phone}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send the verification code");
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) {
      toast.error("Enter the code we sent to your phone");
      return;
    }
    setLoading(true);
    try {
      await createAccount(code.trim());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't verify that code");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      await requestSignupOtp({ email: form.email.trim(), phoneE164: form.phone.trim() });
      setResendCooldown(30);
      toast.success("New code sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't resend the code");
    } finally {
      setLoading(false);
    }
  };

  if (step === "verify") {
    return (
      <form onSubmit={submitCode} className="space-y-4">
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Verify your phone</h2>
          <p className="text-sm text-muted-foreground">
            We sent a {OTP_LENGTH}-digit code to <span className="font-medium">{form.phone}</span>.
            Enter it to finish creating your account.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="signup-otp">Verification code</Label>
          <Input
            id="signup-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            autoFocus
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Verify and create account
        </Button>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button
            type="button"
            className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            onClick={() => void resend()}
            disabled={loading || resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
          </button>
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setStep("details")}
            disabled={loading}
          >
            Change details
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitDetails} className="space-y-4">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Register a partner admin account</h2>
        <p className="text-sm text-muted-foreground">
          Step 1 of 2. We'll verify your phone by SMS, then partner admins complete company
          verification in the onboarding form.
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
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+919876543210"
            required
          />
          <p className="text-xs text-muted-foreground">
            Include your country code — we'll text a code here.
          </p>
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
        Send verification code
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
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("If that account exists, a reset link is on its way.");
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
