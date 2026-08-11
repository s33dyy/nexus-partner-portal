import { join, normalize } from "node:path";

const DIST = join(import.meta.dir, "dist");
const INDEX = join(DIST, "index.html");

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "::";

Bun.serve({
  port,
  hostname,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    // normalize() collapses any "../" before it can escape the dist root.
    const candidate = join(DIST, normalize(pathname));
    if (candidate.startsWith(DIST)) {
      const file = Bun.file(candidate);
      if (await file.exists()) return new Response(file);
    }

    // Client-side routing: every unmatched path renders the SPA shell.
    return new Response(Bun.file(INDEX), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

console.info(`[frontend] serving ${DIST} on ${hostname}:${port}`);
