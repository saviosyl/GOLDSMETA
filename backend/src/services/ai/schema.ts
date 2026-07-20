import { z } from "zod";

export const aiExplanationSchema = z
  .object({
    summary: z.array(z.string()).min(1).max(5),
    warnings: z.array(z.string()).max(5),
    recommendWait: z.boolean()
  })
  .strict();

export type AiExplanationOutput = z.infer<typeof aiExplanationSchema>;
