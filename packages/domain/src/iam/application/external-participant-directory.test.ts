import { describe, expect, it, vi } from "vitest";
import { SourceParticipantsSchema } from "@quantum-crm/contracts";
import {
  sourceParticipantReferencesFromRow,
  withSourceParticipants,
} from "./external-participant-directory.js";

describe("historical source participant presentation", () => {
  it("resolves names by location and external ID, deduplicates followers and never changes current ownership", async () => {
    const records = [
      {
        id: "first",
        ownerMemberId: "quantum-owner",
        ...sourceParticipantReferencesFromRow({
          locationId: "source_a",
          ownerExternalId: "advisor",
          followerExternalIds: ["follower", "follower"],
        }),
      },
      {
        id: "second",
        ownerMemberId: null,
        ...sourceParticipantReferencesFromRow({
          locationId: "source_b",
          ownerExternalId: "advisor",
          followerExternalIds: [],
        }),
      },
    ];
    const resolve = vi.fn(async () => [
      { locationId: "source_a", externalId: "advisor", displayName: "Original advisor" },
      { locationId: "source_a", externalId: "follower", displayName: "Original follower" },
    ]);
    const result = await withSourceParticipants(records, { resolve });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual({
      id: "first",
      ownerMemberId: "quantum-owner",
      sourceParticipants: {
        source: "GHL",
        owner: { externalId: "advisor", displayName: "Original advisor" },
        followers: [{ externalId: "follower", displayName: "Original follower" }],
      },
    });
    expect(result[1]?.sourceParticipants?.owner).toEqual({
      externalId: "advisor",
      displayName: null,
    });
    expect(JSON.stringify(result)).not.toContain("locationId");
    expect(SourceParticipantsSchema.safeParse(result[0]?.sourceParticipants).success).toBe(true);
    expect(
      SourceParticipantsSchema.safeParse({
        ...result[0]?.sourceParticipants,
        sourceLocationId: "source_a",
      }).success,
    ).toBe(false);
  });

  it("does not look up a directory without authorized references and rejects malformed projections", async () => {
    const resolve = vi.fn(async () => []);
    expect(await withSourceParticipants([{}], { resolve })).toEqual([{}]);
    expect(resolve).not.toHaveBeenCalled();
    expect(() =>
      sourceParticipantReferencesFromRow({
        locationId: "other?token=secret",
        ownerExternalId: null,
        followerExternalIds: [],
      }),
    ).toThrow();
    expect(() =>
      sourceParticipantReferencesFromRow({
        locationId: "source",
        ownerExternalId: { name: "unsafe" },
        followerExternalIds: [],
      }),
    ).toThrow();
  });
});
