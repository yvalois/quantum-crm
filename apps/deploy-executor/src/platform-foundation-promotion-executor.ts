import type {
  PlatformReleaseRepository,
  PlatformFoundationPromotionRepository,
} from "@quantum-crm/platform-domain";

import {
  PlatformFoundationPromotionClientError,
  type PlatformFoundationPromotionClient,
} from "./platform-foundation-promotion-client.js";

export class PlatformFoundationPromotionExecutor {
  public constructor(
    private readonly promotions: PlatformFoundationPromotionRepository,
    private readonly releases: PlatformReleaseRepository,
    private readonly client: PlatformFoundationPromotionClient,
    private readonly workerId: string,
  ) {}

  public async runOnce(): Promise<boolean> {
    const promotion = await this.promotions.claimNext({
      workerId: this.workerId,
      leaseDurationSeconds: 120,
    });
    if (!promotion) return false;
    let failureCode:
      "UNAVAILABLE" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT" | "PERMISSION_DENIED" | undefined;
    try {
      const release = await this.releases.findById(promotion.releaseId);
      if (!release || release.status !== "VALIDATED" || release.legacyArtifactCatalog) {
        failureCode = "IDENTITY_MISMATCH";
      } else {
        await this.client.reconcile(release.artifacts);
      }
    } catch (error) {
      failureCode =
        error instanceof PlatformFoundationPromotionClientError ? error.reason : "UNAVAILABLE";
    }
    await this.promotions.complete({
      id: promotion.id,
      workerId: this.workerId,
      expectedVersion: promotion.version,
      attempt: promotion.attempt,
      ...(failureCode ? { failureCode } : {}),
    });
    return true;
  }
}
