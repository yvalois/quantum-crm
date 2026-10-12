import { z } from "zod";

export const SourceParticipantSchema = z
  .object({
    externalId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u),
    displayName: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

/** Historical attribution only. These identities never grant CRM access. */
export const SourceParticipantsSchema = z
  .object({
    source: z.literal("GHL"),
    owner: SourceParticipantSchema.nullable(),
    followers: z.array(SourceParticipantSchema).max(500),
  })
  .strict();

export type SourceParticipants = z.infer<typeof SourceParticipantsSchema>;
