import { createServerFn } from "@tanstack/react-start";

import type { EmailProviderChoice, EmailSettingsStatus } from "@/server/email-settings.server";

/**
 * Server functions for the admin email-delivery card.
 *
 * Every one of them re-checks super_admin on the server. The Settings page
 * hides the card for everybody else, but a hidden control is a UI
 * convenience, not an authorisation boundary — the check that matters is
 * this one, and it runs whether or not the card was ever rendered.
 *
 * Nothing here ever returns the stored API key. The status object carries
 * only the last four characters, which is enough to answer "is this the key
 * I pasted?" and useless to anyone who intercepts it.
 */

async function assertSuperAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const authContext = await getAuthContext();
  const roles = authContext.roles ?? [];
  if (!authContext.session?.user.id || !roles.includes("super_admin")) {
    return { ok: false, error: "Only a Super Admin can change email delivery settings" };
  }
  return { ok: true };
}

const getEmailSettingsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: boolean; status: EmailSettingsStatus | null; error: string | null }> => {
    const auth = await assertSuperAdmin();
    if (!auth.ok) return { ok: false, status: null, error: auth.error };
    const { describeEmailSettings } = await import("@/server/email-settings.server");
    return { ok: true, status: await describeEmailSettings(), error: null };
  },
);

const saveEmailSettingsFn = createServerFn({ method: "POST" })
  .validator(
    (input: { provider: EmailProviderChoice; apiKey: string | null; fromAddress: string }) => input,
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; status: EmailSettingsStatus | null; error: string | null }> => {
      const auth = await assertSuperAdmin();
      if (!auth.ok) return { ok: false, status: null, error: auth.error };
      const { saveEmailSettings } = await import("@/server/email-settings.server");
      const result = await saveEmailSettings({
        provider: data.provider,
        apiKey: data.apiKey,
        fromAddress: data.fromAddress,
      });
      return result.ok
        ? { ok: true, status: result.status, error: null }
        : { ok: false, status: null, error: result.error };
    },
  );

const clearEmailSettingsFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; status: EmailSettingsStatus | null; error: string | null }> => {
    const auth = await assertSuperAdmin();
    if (!auth.ok) return { ok: false, status: null, error: auth.error };
    const { clearEmailSettings } = await import("@/server/email-settings.server");
    return { ok: true, status: await clearEmailSettings(), error: null };
  },
);

export async function getEmailSettings() {
  return getEmailSettingsFn();
}

export async function saveEmailSettings(input: {
  provider: EmailProviderChoice;
  apiKey: string | null;
  fromAddress: string;
}) {
  return saveEmailSettingsFn({ data: input });
}

export async function clearEmailSettings() {
  return clearEmailSettingsFn();
}

export type { EmailProviderChoice, EmailSettingsStatus };
