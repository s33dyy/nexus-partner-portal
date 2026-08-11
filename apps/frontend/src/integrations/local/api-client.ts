export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type RequestOptions = {
  query?: Record<string, unknown>;
  formData?: FormData;
};

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(path, API_BASE_URL || window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  return url;
}

export async function apiFetch<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const url = buildUrl(path, options?.query);
  const headers: Record<string, string> = {};

  if (!options?.formData && body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: options?.formData ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
