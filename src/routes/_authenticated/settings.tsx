import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Database,
  IdCard,
  KeyRound,
  Layers3,
  Link2,
  MessageCircle,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";

import { SettingsExportCard } from "@/components/settings-export-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getRouteApi } from "@tanstack/react-router";
import {
  listVisibleExportDatasets,
  type ExportDatasetDescriptor,
  type ExportScope,
} from "@/lib/export-registry";
import {
  confirmWhatsappLink,
  disconnectGoogleAccount,
  disconnectWhatsapp,
  requestWhatsappLink,
  supabase,
  updateProfile,
} from "@/integrations/local/client";
import { validatePasswordChange } from "@/lib/password-policy";

const routeApi = getRouteApi("/_authenticated/settings");

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

const SECTION_META: Record<
  ExportDatasetDescriptor["group"],
  {
    title: string;
    description: string;
    icon: typeof Database;
  }
> = {
  operational: {
    title: "Operational exports",
    description:
      "Current working data from deals, customers, notifications, documents, and rewards.",
    icon: Database,
  },
  governance: {
    title: "Governance exports",
    description:
      "Administrative records for users, partners, reviews, audit, team, and product catalog data.",
    icon: ShieldCheck,
  },
  configuration: {
    title: "Configuration exports",
    description: "Shared dropdown values and approval settings that drive the portal experience.",
    icon: Layers3,
  },
};

function SettingsPage() {
  const { hasRole, profile, refresh } = useAuth();
  const role = hasRole("super_admin")
    ? "super_admin"
    : hasRole("partner_admin")
      ? "partner_admin"
      : "partner_user";
  const roleLabel =
    role === "super_admin"
      ? "Super Admin"
      : role === "partner_admin"
        ? "Partner Admin"
        : "Partner User";

  useRequireAccess("partial");

  const scope = useMemo<ExportScope>(
    () => ({
      role,
      isSuperAdmin: role === "super_admin",
      partnerId: profile?.partner_id ?? null,
      userId: profile?.id ?? null,
      companyName: profile?.company_name ?? null,
    }),
    [profile?.company_name, profile?.id, profile?.partner_id, role],
  );

  const visibleDatasets = useMemo(
    () =>
      listVisibleExportDatasets(role).sort((left, right) => left.label.localeCompare(right.label)),
    [role],
  );

  const searchParams = routeApi.useSearch() as {
    zohoSignConnected?: string;
    zohoSignError?: string;
    passwordReset?: string;
    googleConnected?: string;
    googleError?: string;
  };
  const [passwordDraft, setPasswordDraft] = useState({
    password: "",
    confirmPassword: "",
  });
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ full_name: "", phone: "" });
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [whatsappPhoneDraft, setWhatsappPhoneDraft] = useState("");
  const [whatsappCodeDraft, setWhatsappCodeDraft] = useState("");
  const [whatsappCodeSent, setWhatsappCodeSent] = useState(false);
  const [sendingWhatsappCode, setSendingWhatsappCode] = useState(false);
  const [verifyingWhatsappCode, setVerifyingWhatsappCode] = useState(false);
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setProfileDraft({ full_name: profile.full_name ?? "", phone: profile.phone ?? "" });
  }, [profile]);

  const initials =
    profile?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "U";

  const profileDirty = Boolean(
    profile &&
    (profileDraft.full_name !== (profile.full_name ?? "") ||
      profileDraft.phone !== (profile.phone ?? "")),
  );

  const submitProfileChange = async () => {
    if (!profileDraft.full_name.trim()) {
      toast.error("Full name is required");
      return;
    }
    setUpdatingProfile(true);
    try {
      await updateProfile({
        full_name: profileDraft.full_name.trim(),
        phone: profileDraft.phone.trim() || null,
      });
      await refresh();
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update profile");
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    setDisconnectingGoogle(true);
    try {
      await disconnectGoogleAccount();
      toast.success("Google account disconnected.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect Google account");
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  const handleSendWhatsappCode = async () => {
    const phone = whatsappPhoneDraft.trim();
    if (!phone) {
      toast.error("Enter a phone number first");
      return;
    }
    setSendingWhatsappCode(true);
    try {
      await requestWhatsappLink({ phoneE164: phone });
      setWhatsappCodeSent(true);
      toast.success("Code sent — check your SMS messages.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send verification code");
    } finally {
      setSendingWhatsappCode(false);
    }
  };

  const handleVerifyWhatsappCode = async () => {
    const phone = whatsappPhoneDraft.trim();
    const code = whatsappCodeDraft.trim();
    if (!code) {
      toast.error("Enter the code you received");
      return;
    }
    setVerifyingWhatsappCode(true);
    try {
      await confirmWhatsappLink({ phoneE164: phone, code });
      toast.success("WhatsApp connected!");
      setWhatsappCodeSent(false);
      setWhatsappPhoneDraft("");
      setWhatsappCodeDraft("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to verify code");
    } finally {
      setVerifyingWhatsappCode(false);
    }
  };

  const handleDisconnectWhatsapp = async () => {
    setDisconnectingWhatsapp(true);
    try {
      await disconnectWhatsapp();
      toast.success("WhatsApp disconnected.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect WhatsApp");
    } finally {
      setDisconnectingWhatsapp(false);
    }
  };

  useEffect(() => {
    if (searchParams.zohoSignConnected === "1") {
      toast.success("Zoho Sign connected successfully!");
      // Clean up URL
      window.history.replaceState(null, "", "/settings");
    } else if (searchParams.zohoSignError) {
      toast.error(`Zoho Sign connection failed: ${searchParams.zohoSignError}`);
      window.history.replaceState(null, "", "/settings");
    } else if (searchParams.googleConnected === "1") {
      toast.success("Google account connected!");
      window.history.replaceState(null, "", "/settings");
      void refresh();
    } else if (searchParams.googleError) {
      toast.error(`Google connection failed: ${searchParams.googleError}`);
      window.history.replaceState(null, "", "/settings");
    }
  }, [searchParams, refresh]);

  const groupedDatasets = useMemo(() => {
    const buckets: Record<ExportDatasetDescriptor["group"], ExportDatasetDescriptor[]> = {
      operational: [],
      governance: [],
      configuration: [],
    };

    for (const dataset of visibleDatasets) {
      buckets[dataset.group].push(dataset);
    }

    for (const datasets of Object.values(buckets)) {
      datasets.sort((left, right) => left.label.localeCompare(right.label));
    }

    return buckets;
  }, [visibleDatasets]);

  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [countsLoading, setCountsLoading] = useState(true);

  const submitPasswordChange = async () => {
    const result = validatePasswordChange(passwordDraft);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    setUpdatingPassword(true);
    try {
      const response = await supabase.auth.updateUser({ password: passwordDraft.password });
      if (response.error) {
        throw new Error(response.error.message);
      }
      await refresh();
      setPasswordDraft({ password: "", confirmPassword: "" });
      toast.success(
        profile?.must_reset_password
          ? "Password updated. Your account is ready to use."
          : "Password updated successfully.",
      );
      if (searchParams.passwordReset === "1") {
        window.history.replaceState(null, "", "/settings");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update password");
    } finally {
      setUpdatingPassword(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadCounts = async () => {
      setCountsLoading(true);

      const results = await Promise.allSettled(
        visibleDatasets.map(
          async (dataset) => [dataset.id, await dataset.loadCount(scope)] as const,
        ),
      );

      if (!active) {
        return;
      }

      const nextCounts: Record<string, number | null> = {};
      for (const result of results) {
        if (result.status === "fulfilled") {
          const [datasetId, count] = result.value;
          nextCounts[datasetId] = count;
        }
      }

      for (const dataset of visibleDatasets) {
        if (!(dataset.id in nextCounts)) {
          nextCounts[dataset.id] = null;
        }
      }

      setCounts(nextCounts);
      setCountsLoading(false);
    };

    void loadCounts();

    return () => {
      active = false;
    };
  }, [scope, visibleDatasets]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <IdCard className="h-3.5 w-3.5" />
            Settings
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Manage your profile, security, connected accounts, and data exports — all scoped to what
            your role can see.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{roleLabel}</Badge>
          {profile?.company_name ? <Badge variant="outline">{profile.company_name}</Badge> : null}
          <Badge variant="outline">{visibleDatasets.length} exportable datasets</Badge>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <UserIcon className="h-3.5 w-3.5" />
        Account
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <UserIcon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Profile</CardTitle>
          </div>
          <CardDescription>
            Your personal details. Email and company are managed elsewhere and shown here for
            reference.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 py-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14">
                <AvatarFallback className="bg-primary text-lg text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium">{profile?.full_name || "Unnamed"}</div>
                <div className="text-sm text-muted-foreground">{profile?.email}</div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-full-name">Full name</Label>
                <Input
                  id="profile-full-name"
                  value={profileDraft.full_name}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, full_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-phone">Phone</Label>
                <Input
                  id="profile-phone"
                  type="tel"
                  value={profileDraft.phone}
                  onChange={(event) =>
                    setProfileDraft((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </div>
            </div>
            <Button
              onClick={() => void submitProfileChange()}
              disabled={updatingProfile || !profileDirty}
            >
              {updatingProfile ? "Saving..." : "Save changes"}
            </Button>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground">Email</div>
              <div className="mt-1">{profile?.email}</div>
            </div>
            {profile?.company_name && (
              <div>
                <div className="font-medium text-foreground">Company</div>
                <div className="mt-1">{profile.company_name}</div>
              </div>
            )}
            <div>
              <div className="font-medium text-foreground">Role</div>
              <div className="mt-1">{roleLabel}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="text-base">How this hub works</CardTitle>
          <CardDescription>
            Each card downloads one scoped CSV, so the export matches the data you are allowed to
            see.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 py-5 md:grid-cols-3">
          <InfoTile
            title="Separate downloads"
            description="Every dataset gets its own CSV file, so exports stay easy to find and share."
          />
          <InfoTile
            title="Scope-aware access"
            description="Hidden datasets stay hidden, and partner users only export their own records."
          />
          <InfoTile
            title="Source links"
            description="When a dataset has a source page, the card links straight back to it."
          />
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Security</CardTitle>
          </div>
          <CardDescription>
            Change your current password from inside the portal. Temporary passwords issued during
            partner approval must be replaced here before normal access continues.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 py-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-password">New password</Label>
                <Input
                  id="settings-password"
                  type="password"
                  autoComplete="new-password"
                  value={passwordDraft.password}
                  onChange={(event) =>
                    setPasswordDraft((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-password-confirm">Confirm password</Label>
                <Input
                  id="settings-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={passwordDraft.confirmPassword}
                  onChange={(event) =>
                    setPasswordDraft((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void submitPasswordChange()} disabled={updatingPassword}>
                {updatingPassword ? "Updating password..." : "Update password"}
              </Button>
              <Badge variant={profile?.must_reset_password ? "destructive" : "secondary"}>
                {profile?.must_reset_password ? "Reset required" : "Password active"}
              </Badge>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Password rules</div>
            <div className="mt-2">
              Use 8 or more characters with at least one uppercase letter, one lowercase letter, one
              number, and one symbol.
            </div>
            {profile?.must_reset_password || searchParams.passwordReset === "1" ? (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-foreground">
                Your current sign-in uses a temporary password. Update it here before continuing to
                the rest of the portal.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Google account</CardTitle>
          </div>
          <CardDescription>
            Connect your Google account so you can sign in with it, instead of only your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-between rounded-xl border bg-muted/20 p-4">
            {profile?.google_email ? (
              <>
                <div>
                  <div className="font-medium">Connected as {profile.google_email}</div>
                  {profile.google_linked_at && (
                    <div className="text-sm text-muted-foreground mt-1">
                      Since {new Date(profile.google_linked_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => void handleDisconnectGoogle()}
                  disabled={disconnectingGoogle}
                >
                  {disconnectingGoogle ? "Disconnecting..." : "Disconnect"}
                </Button>
              </>
            ) : (
              <>
                <div>
                  <div className="font-medium">Not connected</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Link your Google account for a faster sign-in.
                  </div>
                </div>
                <Button asChild>
                  <a href="/api/auth/google/connect">Connect Google Account</a>
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">WhatsApp</CardTitle>
          </div>
          <CardDescription>
            Link a WhatsApp number so you can talk to the Assistant there too. We text you a
            one-time code to confirm it's yours.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          <div className="rounded-xl border bg-muted/20 p-4">
            {profile?.whatsapp_phone_e164 ? (
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    Connected as {"•".repeat(Math.max(profile.whatsapp_phone_e164.length - 4, 0))}
                    {profile.whatsapp_phone_e164.slice(-4)}
                  </div>
                  {profile.whatsapp_verified_at && (
                    <div className="text-sm text-muted-foreground mt-1">
                      Since {new Date(profile.whatsapp_verified_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => void handleDisconnectWhatsapp()}
                  disabled={disconnectingWhatsapp}
                >
                  {disconnectingWhatsapp ? "Disconnecting..." : "Disconnect"}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="settings-whatsapp-phone">Phone number</Label>
                    <Input
                      id="settings-whatsapp-phone"
                      placeholder="+14155552671"
                      value={whatsappPhoneDraft}
                      onChange={(event) => setWhatsappPhoneDraft(event.target.value)}
                      disabled={whatsappCodeSent}
                    />
                  </div>
                  {!whatsappCodeSent && (
                    <Button
                      onClick={() => void handleSendWhatsappCode()}
                      disabled={sendingWhatsappCode || !whatsappPhoneDraft.trim()}
                    >
                      {sendingWhatsappCode ? "Sending..." : "Send code"}
                    </Button>
                  )}
                </div>
                {whatsappCodeSent && (
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="settings-whatsapp-code">Verification code</Label>
                      <Input
                        id="settings-whatsapp-code"
                        placeholder="123456"
                        value={whatsappCodeDraft}
                        onChange={(event) => setWhatsappCodeDraft(event.target.value)}
                      />
                    </div>
                    <Button
                      onClick={() => void handleVerifyWhatsappCode()}
                      disabled={verifyingWhatsappCode || !whatsappCodeDraft.trim()}
                    >
                      {verifyingWhatsappCode ? "Verifying..." : "Verify"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setWhatsappCodeSent(false);
                        setWhatsappCodeDraft("");
                      }}
                    >
                      Change number
                    </Button>
                  </div>
                )}
                <div className="text-sm text-muted-foreground">
                  Use international format, e.g. +14155552671. The code arrives by SMS.
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <SectionBlock
        title={SECTION_META.operational.title}
        description={SECTION_META.operational.description}
        icon={SECTION_META.operational.icon}
        datasets={groupedDatasets.operational}
        scope={scope}
        counts={counts}
        countsLoading={countsLoading}
      />

      {/* product.md §16.4: "Partner-facing Settings do not include ...
          Governance exports; Configuration exports" — gated to super_admin
          rather than relying on per-dataset visibleTo, so a partner role
          never sees these section headers at all, even empty. */}
      {role === "super_admin" && (
        <>
          <SectionBlock
            title={SECTION_META.governance.title}
            description={SECTION_META.governance.description}
            icon={SECTION_META.governance.icon}
            datasets={groupedDatasets.governance}
            scope={scope}
            counts={counts}
            countsLoading={countsLoading}
          />

          <SectionBlock
            title={SECTION_META.configuration.title}
            description={SECTION_META.configuration.description}
            icon={SECTION_META.configuration.icon}
            datasets={groupedDatasets.configuration}
            scope={scope}
            counts={counts}
            countsLoading={countsLoading}
          />
        </>
      )}

      {role === "super_admin" && (
        <>
          <Separator />
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-lg">Integrations</CardTitle>
              </div>
              <CardDescription>
                Manage third-party integrations and platform connections.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl border bg-muted/20 p-4">
                <div>
                  <div className="font-medium">Zoho Sign</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Connect Zoho Sign to automatically send and track digital partner agreements.
                  </div>
                </div>
                <Button asChild>
                  <a href="/api/integrations/zoho-sign/connect">Connect Zoho Sign</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

type SectionBlockProps = {
  title: string;
  description: string;
  icon: typeof Database;
  datasets: ExportDatasetDescriptor[];
  scope: ExportScope;
  counts: Record<string, number | null>;
  countsLoading: boolean;
};

function SectionBlock({
  title,
  description,
  icon: Icon,
  datasets,
  scope,
  counts,
  countsLoading,
}: SectionBlockProps) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        {datasets.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
            No exportable datasets are visible in this section for your current role.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {datasets.map((dataset) => (
              <SettingsExportCard
                key={dataset.id}
                dataset={dataset}
                scope={scope}
                count={counts[dataset.id] ?? null}
                loadingCount={countsLoading}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoTile({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}
