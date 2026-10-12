import { z } from "zod";

/** Read-only MCP result for the single leased conversation execution. */
export const AgentConversationContextSchema = z
  .object({
    threadId: z.string().uuid(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["customer", "advisor", "agent"]),
            text: z.string().min(1).max(1_200),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type AgentConversationContext = z.infer<typeof AgentConversationContextSchema>;
