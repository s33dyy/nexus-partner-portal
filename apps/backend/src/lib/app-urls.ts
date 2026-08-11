export function frontendUrl(): string {
  const value = process.env.FRONTEND_URL;
  if (!value) {
    throw new Error("Missing FRONTEND_URL");
  }
  return value.replace(/\/+$/, "");
}

export function frontendRedirect(path: string): string {
  return new URL(path, `${frontendUrl()}/`).toString();
}
