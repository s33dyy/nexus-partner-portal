import { expect, test } from "bun:test";

import { buildShellContextSummary, getShellNotificationDots } from "@/components/app-shell.utils";
import type { AssignmentRecord } from "@/domain/contracts/governance";

test("buildShellContextSummary flags missing assignments explicitly", () => {
  const summary = buildShellContextSummary({
    assignment: null,
    activeContext: null,
  });

  expect(summary.state).toBe("assignment-pending");
  expect(summary.title).toBe("No governed assignment");
  expect(summary.roleLabel).toBe("Assignment pending");
  expect(summary.scopeLabel).toBe("Context pending");
});

test("buildShellContextSummary surfaces the active governed context", () => {
  const summary = buildShellContextSummary({
    assignment: {
      assignmentId: "assignment-1",
      userId: "user-1",
      tenantId: "tenant-1",
      organizationTenantId: "tenant-1",
      roleKey: "partner_admin",
      status: "active",
      validFrom: "2026-07-29T00:00:00.000Z",
      validTo: null,
      baseGeographyNodeId: null,
      managerAssignmentId: null,
      predecessorAssignmentId: null,
      successorAssignmentId: null,
      version: 1,
      isSeed: false,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    } as unknown as AssignmentRecord,
    activeContext: {
      contextId: "context-1",
      userId: "user-1",
      assignmentId: "assignment-1",
      assignmentStatus: "active",
      tenantId: "tenant-1",
      organizationTenantId: "tenant-1",
      workingScope: "north_zone",
      issuedAt: "2026-07-29T00:00:00.000Z",
      expiresAt: "2026-07-30T00:00:00.000Z",
      version: 1,
      revocationLink: null,
      correlationId: "corr-1",
      assignmentVersion: 1,
      workingScopeNodeId: "node-1",
      revokedAt: null,
      revocationReason: null,
      isSeed: true,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  });

  expect(summary.state).toBe("ready");
  expect(summary.title).toBe("partner admin");
  expect(summary.scopeLabel).toBe("north zone");
  expect(summary.statusLabel).toBe("Assignment active");
  expect(summary.tenantLabel).toBe("Tenant tenant-1");
});

test("getShellNotificationDots marks pending approvals, actionable tasks, and unread notifications", () => {
  expect(
    getShellNotificationDots({
      canReadDealApprovals: true,
      pendingDealApprovals: 1,
      canReadTasks: true,
      currentUserId: "user-1",
      tasks: [
        { status: "to_do", creator_id: "user-1", assignee_id: null },
        { status: "completed", creator_id: "user-1", assignee_id: null },
      ],
      unreadNotifications: 2,
    }),
  ).toEqual({ dealApprovals: true, tasks: true, notifications: true });
});

test("getShellNotificationDots ignores completed and cancelled tasks", () => {
  expect(
    getShellNotificationDots({
      canReadDealApprovals: true,
      pendingDealApprovals: 0,
      canReadTasks: true,
      currentUserId: "user-1",
      tasks: [
        { status: "completed", creator_id: "user-1", assignee_id: null },
        { status: "cancelled", creator_id: "user-1", assignee_id: null },
      ],
      unreadNotifications: 0,
    }),
  ).toEqual({ dealApprovals: false, tasks: false, notifications: false });
});

test("getShellNotificationDots does not expose indicators without read access", () => {
  expect(
    getShellNotificationDots({
      canReadDealApprovals: false,
      pendingDealApprovals: 3,
      canReadTasks: false,
      currentUserId: "user-1",
      tasks: [{ status: "in_progress", creator_id: "user-1", assignee_id: null }],
      unreadNotifications: 1,
    }),
  ).toEqual({ dealApprovals: false, tasks: false, notifications: true });
});

test("getShellNotificationDots ignores open tasks unrelated to the current user", () => {
  expect(
    getShellNotificationDots({
      canReadDealApprovals: false,
      pendingDealApprovals: 0,
      canReadTasks: true,
      currentUserId: "user-1",
      tasks: [{ status: "in_progress", creator_id: "user-2", assignee_id: "user-3" }],
      unreadNotifications: 0,
    }),
  ).toEqual({ dealApprovals: false, tasks: false, notifications: false });
});
