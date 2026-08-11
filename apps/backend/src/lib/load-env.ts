import { resolve } from "node:path";

import { config } from "dotenv";

// Local dev keeps one .env at the repo root, above this workspace. In
// production the platform injects real env vars and neither file exists,
// so both calls are no-ops.
config({ path: resolve(import.meta.dir, "../../.env") });
config({ path: resolve(import.meta.dir, "../../../../.env") });
