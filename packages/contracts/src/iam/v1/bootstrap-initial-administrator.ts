import { z } from "zod";

const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);
const UuidSchema = z.string().uuid();

/** The subject was verified during identity activation; tenant, role and email never enter HTTP. */
export const BootstrapInitialAdministratorSchema = z
  .object({
    subject: z.string().regex(/^[!-~]{1,255}$/u),
  })
  .strict();
export const BootstrapInitialAdministratorResponseSchema = z.object({
  data: z.object({
    id: UuidSchema,
    status: z.literal("ACTIVE"),
    authorizationRevision: z.string().regex(/^[1-9][0-9]*$/u),
  }),
  replayed: z.boolean(),
});
export { IdempotencyKeySchema };
export type BootstrapInitialAdministratorResponse = z.infer<
  typeof BootstrapInitialAdministratorResponseSchema
>;
