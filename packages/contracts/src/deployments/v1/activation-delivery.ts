import { z } from "zod";

const UuidSchema = z.string().uuid();
const VersionSchema = z.string().regex(/^[1-9][0-9]*$/u);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ActivationDeliveryRequestSchema = z.object({}).strict();

export const ActivationDeliveryResponseSchema = z.object({
  schemaVersion: z.literal("activation-delivery/v1"),
  data: z.object({
    url: z.string().url().max(8_192),
    expiresAt: IsoDateTimeSchema,
  }),
  meta: z.object({
    intentId: UuidSchema,
    tenantProfileId: UuidSchema,
    generation: z.number().int().positive(),
    version: VersionSchema,
  }),
});

/** Private, executor-to-admin-api transport. It must never be persisted. */
export const ActivationDeliveryCallbackSchema = z.object({
  intentId: UuidSchema,
  tenantProfileId: UuidSchema,
  operatorId: UuidSchema,
  generation: z.number().int().positive(),
  correlationId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  url: z.string().url().max(8_192),
});

export type ActivationDeliveryResponse = z.infer<typeof ActivationDeliveryResponseSchema>;
export type ActivationDeliveryCallback = z.infer<typeof ActivationDeliveryCallbackSchema>;
