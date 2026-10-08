import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPlatformOperatorProvisioner,
  PlatformOperatorProvisioningError,
} from "./platform-operator-provisioner.js";

const assignmentId = "01999abc-7def-7000-8000-000000000001";
const subject = "01999abc-7def-7000-8000-000000000002";
const email = "david@example.com";
const token = "x".repeat(32);

function provisioner() {
  return createPlatformOperatorProvisioner({
    keycloakAdminOrigin: "https://identity.example.com",
    clientId: "quantum-provisioner",
    clientSecret: "test-client-secret",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("platform operator provisioner", () => {
  it("accepts the exact identity created by this request when Keycloak omits the marker", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: token }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json([{ id: subject, username: email, email }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provisioner().provision({ assignmentId, displayName: "David", email }),
    ).resolves.toMatchObject({ subject, temporaryPassword: expect.stringMatching(/^Aa9!.+/u) });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4]?.[0].toString()).toContain(`${subject}/reset-password`);
  });

  it("removes a newly created identity when its temporary password cannot be configured", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: token }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(Response.json([{ id: subject, username: email, email }]))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provisioner().provision({ assignmentId, displayName: "David", email }),
    ).rejects.toBeInstanceOf(PlatformOperatorProvisioningError);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("does not adopt an existing unmarked identity", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: token }))
      .mockResolvedValueOnce(Response.json([{ id: subject, username: email, email }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provisioner().provision({ assignmentId, displayName: "David", email }),
    ).rejects.toBeInstanceOf(PlatformOperatorProvisioningError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
