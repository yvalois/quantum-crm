import { z } from "zod";

export const HealthCheckSchema = z.enum(["live", "ready"]);

export const HealthStatusSchema = z
  .object({
    schemaVersion: z.literal("health/v1"),
    service: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    check: HealthCheckSchema,
    status: z.enum(["ok", "not_ready"]),
  })
  .strict();

export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export function createHealthStatus(input: {
  service: string;
  check: HealthCheck;
  ready?: boolean;
}): HealthStatus {
  return HealthStatusSchema.parse({
    schemaVersion: "health/v1",
    service: input.service,
    check: input.check,
    status: input.ready === false ? "not_ready" : "ok",
  });
}
