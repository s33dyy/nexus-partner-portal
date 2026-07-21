import { createServerFn } from "@tanstack/react-start";

import type {
  AppRole,
  LocalSession,
  LocalUser,
  PartnerStatus,
  TableQuery,
} from "@/server/livey-service.server";

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

type AuthStateChangeListener = (event: AuthChangeEvent, session: LocalSession | null) => void;

type QueryState = TableQuery & { select?: string };

const authListeners = new Set<AuthStateChangeListener>();

function emitAuth(event: AuthChangeEvent, session: LocalSession | null) {
  for (const listener of authListeners) {
    listener(event, session);
  }
}

const executeTableQuery = createServerFn({ method: "POST" })
  .validator((input: TableQuery) => input)
  .handler(async ({ data }) => {
    const { queryTable } = await import("@/server/livey-service.server");
    return queryTable(data);
  });

const getAuthContext = createServerFn({ method: "GET" }).handler(async () => {
  const { getAuthContext } = await import("@/server/livey-service.server");
  return getAuthContext();
});

const signIn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { signInWithPassword } = await import("@/server/livey-service.server");
    return signInWithPassword(data.email, data.password);
  });

const signUp = createServerFn({ method: "POST" })
  .validator(
    (input: {
      email: string;
      password: string;
      options?: {
        data?: {
          full_name?: string;
          phone?: string;
          company_name?: string;
        };
      };
    }) => input,
  )
  .handler(async ({ data }) => {
    const { signUpLocal } = await import("@/server/livey-service.server");
    await signUpLocal({
      email: data.email,
      password: data.password,
      full_name: data.options?.data?.full_name ?? "Partner User",
      phone: data.options?.data?.phone ?? "",
      company_name: data.options?.data?.company_name ?? null,
    });
    return {};
  });

const createUser = createServerFn({ method: "POST" })
  .validator(
    (input: {
      full_name: string;
      email: string;
      phone: string;
      company_name: string | null;
      password: string;
      role: AppRole;
      partner_status?: PartnerStatus;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { createWorkspaceUser } = await import("@/server/livey-service.server");
    return createWorkspaceUser(data);
  });

const requestReset = createServerFn({ method: "POST" })
  .validator((input: { email: string; redirectTo?: string }) => input)
  .handler(async ({ data }) => {
    const { requestPasswordReset } = await import("@/server/livey-service.server");
    return requestPasswordReset(data.email);
  });

const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { signOutLocal } = await import("@/server/livey-service.server");
  await signOutLocal();
  return {};
});

const updatePassword = createServerFn({ method: "POST" })
  .validator((input: { password: string }) => input)
  .handler(async ({ data }) => {
    const { updatePasswordFromSession } = await import("@/server/livey-service.server");
    return updatePasswordFromSession(data.password);
  });

const completeReset = createServerFn({ method: "POST" })
  .validator((input: { token: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { completePasswordReset } = await import("@/server/livey-service.server");
    return completePasswordReset(data.token, data.password);
  });

const uploadDocument = createServerFn({ method: "POST" })
  .validator((input: FormData) => input)
  .handler(async ({ data }) => {
    const { uploadDocumentBlob } = await import("@/server/livey-service.server");

    const bucket = String(data.get("bucket") ?? "partner-documents");
    const filePath = String(data.get("filePath") ?? "");
    const fileName = String(data.get("fileName") ?? filePath.split("/").pop() ?? "document");
    const mimeType = String(data.get("mimeType") ?? "application/octet-stream");
    const file = data.get("file");

    if (!(file instanceof File)) {
      throw new Error("Missing file");
    }

    return uploadDocumentBlob({
      bucket,
      filePath,
      fileName,
      mimeType,
      file,
      isSeed: String(data.get("isSeed") ?? "false") === "true",
    });
  });

const createSignedUrl = createServerFn({ method: "POST" })
  .validator((input: { bucket: string; path: string; expiresIn: number }) => input)
  .handler(async ({ data }) => {
    const { createDocumentDataUrl } = await import("@/server/livey-service.server");
    const result = await createDocumentDataUrl(data.path);
    return { signedUrl: result.signedUrl };
  });

const removeDocuments = createServerFn({ method: "POST" })
  .validator((input: { bucket: string; paths: string[] }) => input)
  .handler(async ({ data }) => {
    const { removeDocumentBlobs } = await import("@/server/livey-service.server");
    return removeDocumentBlobs(data.paths);
  });

export async function completePasswordReset(token: string, password: string) {
  return completeReset({ data: { token, password } });
}

export async function requestPasswordReset(email: string, redirectTo?: string) {
  return requestReset({ data: { email, redirectTo } });
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
    this.state.operation = "select";
    this.state.select = columns;
    return this;
  }

  insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.state.operation = "insert";
    this.state.values = values;
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
      return await executeTableQuery({ data: this.state });
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
        const result = await uploadDocument({ data: form });
        return { data: result, error: null };
      } catch (error) {
        return {
          data: null,
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    async createSignedUrl(path: string, expiresIn: number): Promise<RpcResult<{ signedUrl: string }>> {
      try {
        const data = await createSignedUrl({ data: { bucket, path, expiresIn } });
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
        const data = await removeDocuments({ data: { bucket, paths } });
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

type AuthApi = {
  getSession: () => Promise<{ data: { session: LocalSession | null } }>;
  getUser: () => Promise<{ data: { user: LocalUser | null } }>;
  onAuthStateChange: (
    callback: AuthStateChangeListener,
  ) => { data: { subscription: { unsubscribe: () => void } } };
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
  ) => Promise<RpcResult<{ resetLink: string | null }>>;
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
  }) => Promise<RpcResult<{
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    company_name: string | null;
    role: AppRole;
    partner_status: PartnerStatus;
  }>>;
};

const auth: AuthApi = {
  async getSession() {
    const data = await getAuthContext();
    return { data: { session: data.session } };
  },
  async getUser() {
    const data = await getAuthContext();
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
      const data = await signIn({ data: input });
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
      const data = await signUp({ data: input });
      emitAuth("SIGNED_IN", data.session ?? null);
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
      await updatePassword({ data: input });
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
      await signOut();
      emitAuth("SIGNED_OUT", null);
      return { data: {}, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
  async createWorkspaceUser(input) {
    try {
      const data = await createUser({ data: input });
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
