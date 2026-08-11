import "@/lib/load-env";

import { app } from "./app";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "::";

Bun.serve({ port, hostname, fetch: app.fetch });

console.info(`[backend] listening on ${hostname}:${port}`);
