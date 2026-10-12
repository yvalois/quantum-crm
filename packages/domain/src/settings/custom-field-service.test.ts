import { describe, expect, it, vi } from "vitest";
import { IamAuthorizationError } from "../iam/index.js";
import {
  CustomFieldDefinitionService,
  CustomFieldDefinitionValidationError,
} from "./custom-field-service.js";

describe("custom field definition catalog", () => {
  it("requires the owning model read permission before consulting settings", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const service = new CustomFieldDefinitionService({ list });
    expect(() => service.list([], { model: "contact", limit: 100 })).toThrow(IamAuthorizationError);
    expect(() => service.list(["crm:sales:read"], { model: "contact", limit: 100 })).toThrow(
      IamAuthorizationError,
    );
    expect(() => service.list(["crm:contacts:read"], { model: "opportunity", limit: 100 })).toThrow(
      IamAuthorizationError,
    );
    expect(list).not.toHaveBeenCalled();
    await service.list(["crm:contacts:read"], { model: "contact", limit: 100 });
    await service.list(["crm:sales:read"], { model: "opportunity", limit: 100 });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("rejects unbounded pages and malformed cursors", () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const service = new CustomFieldDefinitionService({ list });
    for (const limit of [0, 101, 1.5, NaN])
      expect(() => service.list(["crm:contacts:read"], { model: "contact", limit })).toThrow(
        CustomFieldDefinitionValidationError,
      );
    expect(() =>
      service.list(["crm:contacts:read"], { model: "contact", limit: 100, cursor: "../profile-b" }),
    ).toThrow(CustomFieldDefinitionValidationError);
    expect(list).not.toHaveBeenCalled();
  });
});
