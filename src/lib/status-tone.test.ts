import { describe, expect, test } from "bun:test";

import { normalizeStatusKey, resolveStatusTone } from "@/lib/status-tone";

describe("normalizeStatusKey", () => {
  // The same concept reaches this function as "in_progress", "In Progress"
  // and "in-progress" depending on which module wrote the row.
  test("folds case, spaces and hyphens to one key", () => {
    expect(normalizeStatusKey("In Progress")).toBe("in_progress");
    expect(normalizeStatusKey("in-progress")).toBe("in_progress");
    expect(normalizeStatusKey("  IN_PROGRESS  ")).toBe("in_progress");
  });
});

describe("resolveStatusTone", () => {
  test("terminal-good statuses are success", () => {
    for (const status of ["won", "approved", "active", "completed", "resolved", "signed"]) {
      expect(resolveStatusTone(status)).toBe("success");
    }
  });

  test("terminal-bad statuses are danger", () => {
    for (const status of ["lost", "rejected", "failed", "cancelled", "revoked", "expired"]) {
      expect(resolveStatusTone(status)).toBe("danger");
    }
  });

  test("waiting-on-someone statuses are warning", () => {
    for (const status of ["pending", "submitted", "under_review", "need_more_info", "draft"]) {
      expect(resolveStatusTone(status)).toBe("warning");
    }
  });

  test("in-flight statuses are info", () => {
    for (const status of ["in_progress", "open", "negotiation", "qualified", "testing"]) {
      expect(resolveStatusTone(status)).toBe("info");
    }
  });

  test("priority levels map onto the same danger/warning/neutral ladder", () => {
    expect(resolveStatusTone("high")).toBe("danger");
    expect(resolveStatusTone("urgent")).toBe("danger");
    expect(resolveStatusTone("medium")).toBe("warning");
    expect(resolveStatusTone("low")).toBe("neutral");
  });

  test("the real deal-stage vocabulary resolves without falling through", () => {
    // DEAL_STAGE_ORDER from portal-records, minus the ones already covered.
    const stages = ["sourced", "demo", "testing", "proposal", "negotiation", "won", "lost"];
    const tones = stages.map((s) => resolveStatusTone(s, "brand"));
    // "brand" is the sentinel for "no rule matched" here — nothing should use it.
    expect(tones).not.toContain("brand");
  });

  test("compound statuses resolve on the substring rules", () => {
    expect(resolveStatusTone("waiting_on_partner")).toBe("warning");
    expect(resolveStatusTone("waiting_on_livey")).toBe("warning");
    expect(resolveStatusTone("signed_pending_review")).toBe("warning");
    expect(resolveStatusTone("reopen_requested")).toBe("warning");
    expect(resolveStatusTone("commercially_approved")).toBe("success");
  });

  // A status nobody has taught this table about must read as unremarkable
  // metadata, not borrow the weight of a real success or failure.
  test("an unknown status is neutral, not accidentally good or bad", () => {
    expect(resolveStatusTone("wibble")).toBe("neutral");
    expect(resolveStatusTone("")).toBe("neutral");
    expect(resolveStatusTone(null)).toBe("neutral");
    expect(resolveStatusTone(undefined)).toBe("neutral");
  });

  test("the fallback is respected when supplied", () => {
    expect(resolveStatusTone("wibble", "info")).toBe("info");
    expect(resolveStatusTone(null, "brand")).toBe("brand");
  });

  test("exact matches win over substring rules", () => {
    // "closed" contains no danger substring and is an exact success; a naive
    // substring pass over "cancel"/"lost" must not reach it first.
    expect(resolveStatusTone("closed")).toBe("success");
    // "open" is exact-info even though "reopened" also exists.
    expect(resolveStatusTone("open")).toBe("info");
    expect(resolveStatusTone("reopened")).toBe("info");
  });
});
