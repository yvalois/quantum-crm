import {
  DashboardLayoutSchema,
  type DashboardLayout,
  type DashboardPeriod,
  type DashboardSnapshot,
} from "@quantum-crm/contracts";
import type { CommercialActor, IamPermission } from "../iam/domain/member.js";

export interface DashboardPreferences {
  readonly layout: DashboardLayout;
  readonly version: string;
  readonly updatedAt: string | null;
}

export function parseDashboardLayout(value: unknown): DashboardLayout {
  return DashboardLayoutSchema.parse(value);
}

export interface DashboardRepository {
  snapshot(input: {
    readonly actor: CommercialActor;
    readonly from: Date | null;
    readonly now: Date;
    readonly period: DashboardPeriod;
    readonly access: Readonly<{
      contacts: boolean;
      conversations: boolean;
      sales: boolean;
      tasks: boolean;
    }>;
  }): Promise<DashboardSnapshot>;
  preferences(memberId: string): Promise<DashboardPreferences>;
  savePreferences(
    memberId: string,
    layout: DashboardLayout,
    expectedVersion: bigint,
  ): Promise<DashboardPreferences | null>;
}

export class DashboardService {
  public constructor(private readonly repository: DashboardRepository) {}

  public snapshot(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    period: DashboardPeriod,
    now = new Date(),
  ) {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
    const from = days === null ? null : new Date(now.getTime() - days * 86_400_000);
    return this.repository.snapshot({
      actor,
      from,
      now,
      period,
      access: {
        contacts: permissions.includes("crm:contacts:read"),
        conversations: permissions.includes("crm:conversations:read"),
        sales: permissions.includes("crm:sales:read"),
        tasks: permissions.includes("crm:tasks:read"),
      },
    });
  }

  public preferences(memberId: string) {
    return this.repository.preferences(memberId);
  }
  public savePreferences(memberId: string, layout: DashboardLayout, expectedVersion: bigint) {
    return this.repository.savePreferences(memberId, layout, expectedVersion);
  }
}
