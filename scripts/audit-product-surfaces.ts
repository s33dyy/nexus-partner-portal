import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Repeatable audit for deceptive product surfaces.
 *
 * The three things this codebase actually shipped and had to unship — a
 * simulated Integration Operations Centre, a permanently-disabled "Add
 * lesson" button, and a voucher adapter that reported success without
 * contacting anything — were all findable by reading the file. Nothing
 * stopped them coming back, so this does.
 *
 * The audit is a linter, not a type checker: it works on source text and
 * strips comments first, because a comment explaining why something was
 * removed must not itself trip the rule that removed it.
 */

export type SurfaceRuleId =
  | "placeholder-text"
  | "fabricated-provider-metrics"
  | "stub-voucher-success"
  | "dead-disabled-action"
  | "ungated-hidden-route"
  | "dms-generic-client";

export type SurfaceViolation = {
  rule: SurfaceRuleId;
  file: string;
  line: number;
  text: string;
  message: string;
};

export type SourceFile = { path: string; content: string };

/**
 * An exception to a rule, with an accountable owner and a date it stops
 * working.
 *
 * An allowlist without an expiry is a permanent exemption pretending to be a
 * temporary one, so an expired entry is itself a violation: the audit fails
 * until somebody either fixes the thing or consciously renews the exception.
 */
export type AllowlistEntry = {
  rule: SurfaceRuleId;
  /** Repo-relative path the exception applies to. */
  path: string;
  /** Substring the offending line must contain, so the exception cannot
   * silently widen to cover a different line in the same file. */
  linePattern: string;
  reason: string;
  owner: string;
  /** ISO date. On and after this date the entry fails the audit. */
  expires: string;
};

export const SURFACE_ALLOWLIST: AllowlistEntry[] = [
  {
    rule: "dead-disabled-action",
    path: "src/routes/_authenticated/admin.learning.tsx",
    linePattern: "Add lesson",
    reason:
      "Lesson authoring is not built. The button is hidden behind the learning-lesson-authoring surface flag, which ships disabled, so it is unreachable in every deployment; it stays disabled rather than being deleted so the flag has something to reveal when the editor lands.",
    owner: "Enablement",
    expires: "2027-03-31",
  },
];

const ACTION_VERBS = [
  "add",
  "approve",
  "assign",
  "cancel",
  "connect",
  "continue",
  "create",
  "delete",
  "disconnect",
  "download",
  "edit",
  "enrol",
  "enroll",
  "export",
  "generate",
  "import",
  "invite",
  "issue",
  "new",
  "pause",
  "publish",
  "reject",
  "remove",
  "request",
  "resume",
  "retry",
  "save",
  "send",
  "start",
  "submit",
  "sync",
  "upload",
];

/** Routes that exist but are gated behind a product-surface flag. Anything
 * that navigates to one must consult the shared gate in the same file. */
const HIDDEN_ROUTES: Array<{ route: string; gate: RegExp }> = [
  {
    route: "/admin/integrations",
    gate: /integrationOperationsCentre/,
  },
  {
    route: "/distribution",
    gate: /distributionCore|showDistributionNavigation|contextualStockAction/,
  },
];

const DMS_TABLES = [
  "stock_locations",
  "stock_requests",
  "stock_request_lines",
  "inventory_balances",
  "inventory_movements",
  "stock_request_transitions",
];

/**
 * Blanks out comment bodies while preserving line numbering.
 *
 * Without this, "this previously returned ok:true with a STUB- code" — the
 * comment recording why the stub was removed — would be reported as a stub.
 */
export function stripComments(content: string): string[] {
  const lines = content.split("\n");
  let inBlock = false;
  return lines.map((line) => {
    let output = "";
    let index = 0;
    while (index < line.length) {
      if (inBlock) {
        const close = line.indexOf("*/", index);
        if (close === -1) {
          index = line.length;
        } else {
          index = close + 2;
          inBlock = false;
        }
        continue;
      }
      if (line.startsWith("//", index)) break;
      if (line.startsWith("/*", index)) {
        inBlock = true;
        index += 2;
        continue;
      }
      output += line[index];
      index += 1;
    }
    return output;
  });
}

function isTestFile(path: string): boolean {
  return /\.test\.[cm]?tsx?$/.test(path) || path.includes("/__tests__/");
}

function isRouteOrComponent(path: string): boolean {
  return path.startsWith("src/routes/") || path.startsWith("src/components/");
}

function looksLikeAction(label: string): boolean {
  const words = label
    .replace(/\{[^}]*\}/g, " ")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  return words.length > 0 && ACTION_VERBS.includes(words[0]!);
}

/**
 * Finds `<Button ... disabled>` where `disabled` is a bare attribute — an
 * action nobody can ever take — and reports it only when the label reads as
 * an action. A disabled button labelled "Gold tier required" is a status
 * explanation, which is the honest way to say why something is unavailable;
 * one labelled "Add lesson" is an advertised action with nothing behind it.
 */
function findDeadDisabledActions(file: SourceFile, lines: string[]): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];
  const source = lines.join("\n");
  const buttonPattern = /<Button\b/g;
  let match: RegExpExecArray | null;

  while ((match = buttonPattern.exec(source)) !== null) {
    const openStart = match.index;
    const openEnd = source.indexOf(">", openStart);
    if (openEnd === -1) continue;
    const attributes = source.slice(openStart, openEnd);
    const bareDisabled = /\sdisabled(\s|$)/.test(attributes) && !/disabled\s*=/.test(attributes);
    if (!bareDisabled) continue;

    const closeIndex = source.indexOf("</Button>", openEnd);
    const label = (closeIndex === -1 ? "" : source.slice(openEnd + 1, closeIndex))
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!looksLikeAction(label)) continue;

    const line = source.slice(0, openStart).split("\n").length;
    violations.push({
      rule: "dead-disabled-action",
      file: file.path,
      line,
      text: label,
      message: `"${label}" is a permanently disabled action. Remove it, or replace the label with the status that explains why it is unavailable.`,
    });
  }
  return violations;
}

export function auditSourceFiles(
  files: SourceFile[],
  options: { allowlist?: AllowlistEntry[]; today?: string } = {},
): SurfaceViolation[] {
  const allowlist = options.allowlist ?? SURFACE_ALLOWLIST;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const violations: SurfaceViolation[] = [];

  // An expired exception is a violation in its own right, reported against
  // this file so it cannot be lost among the source findings.
  for (const entry of allowlist) {
    if (entry.expires <= today) {
      violations.push({
        rule: entry.rule,
        file: "scripts/audit-product-surfaces.ts",
        line: 0,
        text: `${entry.path}: ${entry.linePattern}`,
        message: `Allowlist entry expired on ${entry.expires} (owner: ${entry.owner}). Fix the surface or consciously renew the exception.`,
      });
    }
  }

  const isAllowed = (violation: SurfaceViolation, lineText: string): boolean =>
    allowlist.some(
      (entry) =>
        entry.rule === violation.rule &&
        entry.path === violation.file &&
        entry.expires > today &&
        (lineText.includes(entry.linePattern) || violation.text.includes(entry.linePattern)),
    );

  for (const file of files) {
    if (isTestFile(file.path)) continue;
    const lines = stripComments(file.content);
    const rawLines = file.content.split("\n");
    const stripped = lines.join("\n");
    const candidates: SurfaceViolation[] = [];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      if (isRouteOrComponent(file.path)) {
        const placeholder = /MVP stub|Coming soon|Simulate network delay/i.exec(line);
        if (placeholder) {
          candidates.push({
            rule: "placeholder-text",
            file: file.path,
            line: lineNumber,
            text: line.trim(),
            message: `Placeholder copy "${placeholder[0]}" ships to users as if the surface were real.`,
          });
        }

        const metric = /\b(queueDepth|deadLetterCount|lastOutbound|lastInbound|conflicts)\s*:/.exec(
          line,
        );
        if (metric) {
          candidates.push({
            rule: "fabricated-provider-metrics",
            file: file.path,
            line: lineNumber,
            text: line.trim(),
            message: `"${metric[1]}" is a provider metric hardcoded in the component. Read it from a real source or do not show it.`,
          });
        }
      }

      if (/STUB-/.test(line)) {
        // A STUB- literal is only a problem where something is reporting
        // success with it; the guard that REJECTS one is the fix, not the bug.
        const window = lines.slice(Math.max(0, index - 6), index + 7).join("\n");
        if (/\bok\s*:\s*true/.test(window)) {
          candidates.push({
            rule: "stub-voucher-success",
            file: file.path,
            line: lineNumber,
            text: line.trim(),
            message: "A STUB- voucher is being reported as a successful issuance.",
          });
        }
      }

      const dmsTable = DMS_TABLES.find((table) =>
        new RegExp(`from\\(\\s*["'\`]${table}["'\`]`).test(line),
      );
      if (dmsTable && /supabase|queryTable/.test(stripped)) {
        candidates.push({
          rule: "dms-generic-client",
          file: file.path,
          line: lineNumber,
          text: line.trim(),
          message: `"${dmsTable}" is reached through the generic table client. Every DMS access goes through a named server function (product.md §24.4).`,
        });
      }
    });

    if (isRouteOrComponent(file.path)) {
      candidates.push(...findDeadDisabledActions(file, lines));

      for (const hidden of HIDDEN_ROUTES) {
        // Matches the three ways this codebase names a destination:
        // `url: "/x"` in a nav item, `to="/x"` on a Link, and `to: "/x"` in a
        // navigate() call.
        const navigates = new RegExp(
          `(url:\\s*["'\`]|to=\\{?["'\`]|to:\\s*["'\`])${hidden.route}(["'\`?]|$)`,
        );
        if (navigates.test(stripped) && !hidden.gate.test(stripped)) {
          const line = lines.findIndex((candidate) => candidate.includes(hidden.route)) + 1 || 1;
          candidates.push({
            rule: "ungated-hidden-route",
            file: file.path,
            line,
            text: hidden.route,
            message: `Navigation to ${hidden.route} without the shared product-surface gate. Hiding one entry point while another links straight in is not hiding.`,
          });
        }
      }
    }

    for (const violation of candidates) {
      const lineText = rawLines[violation.line - 1] ?? "";
      if (!isAllowed(violation, lineText)) violations.push(violation);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const SCAN_ROOTS = ["src/routes", "src/components", "src/integrations", "src/server"];

export function collectSourceFiles(root = process.cwd()): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.[cm]?tsx?$/.test(entry)) continue;
      files.push({
        path: relative(root, full).split("\\").join("/"),
        content: readFileSync(full, "utf8"),
      });
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    const full = resolve(root, scanRoot);
    try {
      walk(full);
    } catch {
      // A missing scan root is not a violation — the repo layout may differ.
    }
  }
  return files;
}

export function formatViolations(violations: SurfaceViolation[]): string {
  if (violations.length === 0) {
    return "[audit:surfaces] no unfinished or deceptive product surfaces found";
  }
  const lines = violations.map(
    (violation) =>
      `  ${violation.file}:${violation.line}  [${violation.rule}] ${violation.message}\n      ${violation.text}`,
  );
  return `[audit:surfaces] ${violations.length} violation(s):\n${lines.join("\n")}`;
}

if (import.meta.main) {
  const violations = auditSourceFiles(collectSourceFiles());
  console.log(formatViolations(violations));
  process.exit(violations.length === 0 ? 0 : 1);
}
