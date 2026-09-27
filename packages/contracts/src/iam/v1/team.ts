import { z } from "zod";

const UuidSchema = z.string().uuid();
const DisplayNameSchema = z.string().trim().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const TeamIdSchema = UuidSchema;
export const TeamMemberSchema = z.object({
  id: UuidSchema,
  displayName: DisplayNameSchema,
  email: z.string().email().max(320),
  status: z.enum(["INVITED", "ACTIVE", "DEACTIVATED"]),
});
export const TeamSchema = z.object({
  id: TeamIdSchema,
  name: DisplayNameSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  members: z.array(TeamMemberSchema),
});
export const TeamListResponseSchema = z.object({ data: z.array(TeamSchema) });
export const TeamResponseSchema = z.object({ data: TeamSchema });
export const CreateTeamSchema = z.object({ name: DisplayNameSchema });
export const AddTeamMemberSchema = z.object({ memberId: UuidSchema });

export type Team = z.infer<typeof TeamSchema>;
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export type CreateTeam = z.infer<typeof CreateTeamSchema>;
export type AddTeamMember = z.infer<typeof AddTeamMemberSchema>;
