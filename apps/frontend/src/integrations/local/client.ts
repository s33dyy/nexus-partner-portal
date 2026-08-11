import type { AppRole, LocalSession, LocalUser, PartnerStatus } from "@livey/shared/types/auth";
import type { TableQuery } from "@livey/shared/types/table-query";

import { API_BASE_URL, apiFetch } from "./api-client";

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type AuthChangeEvent =
  "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

type AuthStateChangeListener = (event: AuthChangeEvent, session: LocalSession | null) => void;

type QueryState = TableQuery & { select?: string };

type AuthContextResponse = {
  session: LocalSession | null;
  profile: unknown;
  roles: AppRole[];
};

const authListeners = new Set<AuthStateChangeListener>();

function emitAuth(event: AuthChangeEvent, session: LocalSession | null) {
  for (const listener of authListeners) {
    listener(event, session);
  }
}

class QueryBuilder {
  private state: QueryState;

  constructor(table: string) {
    this.state = {
      table,
      operation: "select",
      filters: [],
      single: null,
    };
  }

  select(columns = "*") {
    this.state.select = columns;
    return this;
  }

  insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.state.operation = "insert";
    this.state.values = values;
    return this;
  }

  count() {
    this.state.operation = "count";
    return this;
  }

  update(values: Record<string, unknown>) {
    this.state.operation = "update";
    this.state.values = values;
    return this;
  }

  delete() {
    this.state.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.state.filters ??= [];
    this.state.filters.push({ column, value, operator: "eq" });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.state.order = { column, ascending: options?.ascending };
    return this;
  }

  limit(count: number) {
    this.state.limit = count;
    return this;
  }

  single() {
    this.state.single = "single";
    return this;
  }

  maybeSingle() {
    this.state.single = "maybeSingle";
    return this;
  }

  async run() {
    try {
      return await apiFetch<RpcResult<unknown>>("POST", "/api/query", this.state);
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  then<TResult1 = RpcResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: RpcResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return (this.run() as Promise<any>).then(onfulfilled as any, onrejected as any);
  }
}

function createStorageBucket(bucket: string) {
  return {
    async upload(
      filePath: string,
      file: File,
      options?: { upsert?: boolean; contentType?: string },
    ): Promise<RpcResult<{ path: string; signedUrl: string; publicId: string }>> {
      try {
        const form = new FormData();
        form.append("bucket", bucket);
        form.append("filePath", filePath);
        form.append("fileName", file.name);
        form.append("mimeType", options?.contentType ?? file.type ?? "application/octet-stream");
        form.append("file", file);
        form.append("isSeed", "false");
        const data = await apiFetch<{ path: string; signedUrl: string; publicId: string }>(
          "POST",
          "/api/documents",
          undefined,
          { formData: form },
        );
        return { data, error: null };
      } catch (error) {
        return {
          data: null,
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    async createSignedUrl(
      path: string,
      expiresIn: number,
    ): Promise<RpcResult<{ signedUrl: string }>> {
      try {
        const data = await apiFetch<{ signedUrl: string }>("POST", "/api/documents/signed-url", {
          bucket,
          path,
          expiresIn,
        });
        return { data, error: null };
      } catch (error) {
        return {
          data: null,
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    async remove(paths: string[]): Promise<RpcResult<{ removed: number }>> {
      try {
        const data = await apiFetch<{ removed: number }>("DELETE", "/api/documents", {
          bucket,
          paths,
        });
        return { data, error: null };
      } catch (error) {
        return {
          data: null,
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  };
}

export async function completePasswordReset(token: string, password: string) {
  return apiFetch<{ session: LocalSession }>("POST", "/api/auth/password/reset", {
    token,
    password,
  });
}

export async function requestPasswordReset(email: string, redirectTo?: string) {
  return apiFetch<{ ok: true }>("POST", "/api/auth/password/forgot", { email, redirectTo });
}

export async function disconnectGoogleAccount() {
  return apiFetch("POST", "/api/auth/google/disconnect");
}

/** Signed-out "Continue with Google" — a plain navigation to the backend. */
export function googleSignInUrl() {
  return `${API_BASE_URL}/api/auth/google/connect`;
}

/**
 * Settings' Connect flow trades the authenticated cookie request for a
 * single-use ticket and hands that to the backend's OAuth entry point.
 */
export async function startGoogleConnect() {
  const { ticket } = await apiFetch<{ ticket: string }>("POST", "/api/auth/google/link-ticket");
  window.location.href = `${googleSignInUrl()}?ticket=${encodeURIComponent(ticket)}`;
}

export async function updateProfile(input: { full_name: string; phone: string | null }) {
  return apiFetch("POST", "/api/auth/profile", input);
}

export async function requestWhatsappLink(input: { phoneE164: string }) {
  return apiFetch("POST", "/api/twilio/request-whatsapp-link", input);
}

export async function confirmWhatsappLink(input: { phoneE164: string; code: string }) {
  return apiFetch("POST", "/api/twilio/confirm-whatsapp-link", input);
}

export async function disconnectWhatsapp() {
  return apiFetch("POST", "/api/twilio/disconnect-whatsapp");
}

export async function mintVoiceAccessToken(): Promise<{ token: string; identity: string }> {
  return apiFetch("POST", "/api/twilio/mint-voice-access-token");
}

export async function setCallDisposition(input: {
  twilioCallSid: string;
  disposition: string;
}): Promise<{ ok: true }> {
  return apiFetch("POST", "/api/twilio/set-call-disposition", input);
}

export async function setCallReady(input: {
  ready: boolean;
}): Promise<{ ok: true; ready: boolean }> {
  return apiFetch("POST", "/api/twilio/set-call-ready", input);
}

export async function uploadRewardImage(input: { file: File; folder?: string; publicId?: string }) {
  try {
    const form = new FormData();
    const folder = input.folder ?? "rewards";
    form.append("file", input.file);
    form.append("folder", folder);
    form.append("publicId", input.publicId ?? `${folder}/${crypto.randomUUID()}`);

    const data = await apiFetch<{ public_id: string; secure_url: string }>(
      "POST",
      "/api/documents/cloudinary-image",
      undefined,
      { formData: form },
    );
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

type AuthApi = {
  getSession: () => Promise<{ data: { session: LocalSession | null } }>;
  getUser: () => Promise<{ data: { user: LocalUser | null } }>;
  onAuthStateChange: (callback: AuthStateChangeListener) => {
    data: { subscription: { unsubscribe: () => void } };
  };
  signInWithPassword: (input: {
    email: string;
    password: string;
  }) => Promise<RpcResult<{ session: LocalSession; user: LocalUser }>>;
  signUp: (input: {
    email: string;
    password: string;
    options?: {
      emailRedirectTo?: string;
      data?: {
        full_name?: string;
        phone?: string;
        company_name?: string;
      };
    };
  }) => Promise<RpcResult<{}>>;
  resetPasswordForEmail: (
    email: string,
    options?: { redirectTo?: string },
  ) => Promise<RpcResult<{ ok: true }>>;
  updateUser: (input: { password: string }) => Promise<RpcResult<{}>>;
  signOut: () => Promise<RpcResult<{}>>;
  createWorkspaceUser: (input: {
    full_name: string;
    email: string;
    phone: string;
    company_name: string | null;
    password: string;
    role: AppRole;
    partner_status?: PartnerStatus;
    partner_id?: string;
    must_reset_password?: boolean;
  }) => Promise<
    RpcResult<{
      id: string;
      email: string;
      full_name: string;
      phone: string | null;
      company_name: string | null;
      role: AppRole;
      partner_status: PartnerStatus;
    }>
  >;
  createWorkspaceUsersBulk: (input: {
    rows: Array<{
      full_name: string;
      email: string;
      phone: string;
      company_name: string | null;
      password: string;
      role: AppRole;
      partner_status?: PartnerStatus;
      partner_id?: string;
      must_reset_password?: boolean;
    }>;
  }) => Promise<
    RpcResult<{
      createdCount: number;
      users: Array<{
        id: string;
        email: string;
        full_name: string;
        phone: string | null;
        company_name: string | null;
        role: AppRole;
        partner_status: PartnerStatus;
      }>;
    }>
  >;
  createPartnerTeamMembersBulk: (input: {
    company_name: string;
    rows: Array<{
      full_name: string;
      email: string;
      phone: string;
      password: string;
      role_title: string;
      portal_role: "partner_admin" | "partner_user";
      responsibility: string;
      status: "invited" | "active" | "paused";
    }>;
  }) => Promise<RpcResult<{ createdCount: number }>>;
  quoteCurrencyToUsd: (input: { sourceCurrency: string; amount: number }) => Promise<
    RpcResult<{
      sourceCurrency: string;
      amount: number;
      rate: number;
      computedUsdAmount: number;
      provider: string;
      timestamp: string;
    }>
  >;
  issueTemporaryPassword: (userId: string) => Promise<RpcResult<{ temporaryPassword: string }>>;
};

const auth: AuthApi = {
  async getSession() {
    const data = await apiFetch<AuthContextResponse>("GET", "/api/auth/session");
    return { data: { session: data.session } };
  },
  async getUser() {
    const data = await apiFetch<AuthContextResponse>("GET", "/api/auth/session");
    return { data: { user: data.session?.user ?? null } };
  },
  onAuthStateChange(callback) {
    authListeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            authListeners.delete(callback);
          },
        },
      },
    };
  },
  async signInWithPassword(input) {
    try {
      const data = await apiFetch<{ session: LocalSession; user: LocalUser }>(
        "POST",
        "/api/auth/login",
        input,
      );
      emitAuth("SIGNED_IN", data.session);
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async signUp(input) {
    try {
      const data = await apiFetch<{ session?: LocalSession | null }>(
        "POST",
        "/api/auth/signup",
        input,
      );
      const session = data.session ?? null;
      emitAuth("SIGNED_IN", session);
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async resetPasswordForEmail(email, options) {
    try {
      const data = await requestPasswordReset(email, options?.redirectTo);
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async updateUser(input) {
    try {
      await apiFetch("POST", "/api/auth/password/update", input);
      emitAuth("USER_UPDATED", null);
      return { data: {}, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async signOut() {
    try {
      await apiFetch("POST", "/api/auth/logout");
      emitAuth("SIGNED_OUT", null);
      return { data: {}, error: null };
    } catch (error) {
      // Clear local UI state even if the server round-trip failed. The actual
      // session credential remains inaccessible in the HttpOnly cookie.
      emitAuth("SIGNED_OUT", null);
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async createWorkspaceUser(input) {
    try {
      const data = await apiFetch<any>("POST", "/api/auth/users", input);
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async createWorkspaceUsersBulk(input) {
    try {
      const data = await apiFetch<any>("POST", "/api/auth/users/bulk", input);
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async createPartnerTeamMembersBulk(input) {
    try {
      const data = await apiFetch<any>("POST", "/api/auth/team-members/bulk", input);
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async quoteCurrencyToUsd(input) {
    try {
      const data = await apiFetch<any>("POST", "/api/auth/fx/quote", input);
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async issueTemporaryPassword(userId) {
    try {
      const data = await apiFetch<{ temporaryPassword: string }>(
        "POST",
        `/api/auth/users/${encodeURIComponent(userId)}/temporary-password`,
      );
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
};

export const supabase = {
  auth,
  from(table: string) {
    return new QueryBuilder(table);
  },
  storage: {
    from(bucket: string) {
      return createStorageBucket(bucket);
    },
  },
};

export type { AppRole, LocalSession as Session, LocalUser as User, PartnerStatus };
