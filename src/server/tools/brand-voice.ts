import { z } from "zod";
import { brandSchema, type BrandProfileInput } from "@/domain/schemas";
import { getDb } from "@/server/db";

const inputSchema = z.object({ projectId: z.string().min(1).max(64) });
const outputSchema = z.object({ profile: brandSchema.nullable(), degraded: z.boolean().optional() });

export function createBrandVoiceTool() {
  return {
    name: "brandVoice",
    label: "Brand profile",
    inputSchema,
    outputSchema,
    async execute(input: z.infer<typeof inputSchema>): Promise<{ profile: BrandProfileInput | null; degraded?: boolean }> {
      const row = await getDb().brandProfile.findUnique({ where: { projectId: input.projectId } });
      if (!row) return { profile: null };
      try {
        const wordsToUse = JSON.parse(row.wordsToUseJson) as unknown;
        const wordsToAvoid = JSON.parse(row.wordsToAvoidJson) as unknown;
        const profile = brandSchema.parse({
          brandName: row.brandName,
          tone: row.tone,
          audience: row.audience,
          preferredLanguage: row.preferredLanguage,
          wordsToUse,
          wordsToAvoid,
          styleGuidance: row.styleGuidance,
          exampleCopy: row.exampleCopy,
        });
        return { profile };
      } catch {
        return { profile: null, degraded: true };
      }
    },
  };
}
