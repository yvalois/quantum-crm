import { describe, expect, it } from "vitest";

import {
  TenantProfileLifecycleTransitionError,
  transitionTenantProfileStatus,
  type TenantProfileLifecycleAction,
  type TenantProfileStatus,
} from "./tenant-profile.js";

describe("tenant profile lifecycle", () => {
  it.each<readonly [TenantProfileStatus, TenantProfileLifecycleAction, TenantProfileStatus]>([
    ["PENDING", "START_PROVISIONING", "PROVISIONING"],
    ["ERROR", "START_PROVISIONING", "PROVISIONING"],
    ["PROVISIONING", "MARK_ACTIVE", "ACTIVE"],
    ["PROVISIONING", "MARK_ERROR", "ERROR"],
    ["ACTIVE", "SUSPEND", "SUSPENDED"],
    ["SUSPENDED", "RESUME", "ACTIVE"],
  ])("moves %s through %s to %s", (current, action, expected) => {
    expect(transitionTenantProfileStatus(current, action)).toBe(expected);
  });

  it.each<readonly [TenantProfileStatus, TenantProfileLifecycleAction]>([
    ["PROVISIONING", "START_PROVISIONING"],
    ["ACTIVE", "MARK_ACTIVE"],
    ["ERROR", "MARK_ERROR"],
    ["SUSPENDED", "SUSPEND"],
    ["ACTIVE", "RESUME"],
  ])("treats a repeated %s/%s result as an idempotent no-op", (current, action) => {
    expect(transitionTenantProfileStatus(current, action)).toBe(current);
  });

  it.each<readonly [TenantProfileStatus, TenantProfileLifecycleAction]>([
    ["PENDING", "MARK_ACTIVE"],
    ["PENDING", "SUSPEND"],
    ["PROVISIONING", "SUSPEND"],
    ["ERROR", "RESUME"],
    ["SUSPENDED", "START_PROVISIONING"],
  ])("rejects %s/%s", (current, action) => {
    expect(() => transitionTenantProfileStatus(current, action)).toThrow(
      TenantProfileLifecycleTransitionError,
    );
  });
});
