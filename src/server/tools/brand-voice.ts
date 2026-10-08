import { z } from "zod";
import { brandSchema, type BrandProfileInput } from "@/domain/schemas";
import { getDb } from "@/server/db";

const inputSchema = z.object({ projectId: z.string().min(1).max(64) });
const outputSchema = z.object({ profile: brandSchema.nullable() });

export function createBrandVoiceTool() {
  return {
    name: "brandVoice",
    label: "Brand profile",
    inputSchema,
    outputSchema,
    async execute(input: z.infer<typeof inputSchema>): Promise<{ profile: BrandProfileInput | null }> {
      const row = await getDb().brandProfile.findUnique({ where: { projectId: input.projectId } });
      if (!row) return { profile: null };
      const profile = brandSchema.parse({
        brandName: row.brandName,
        tone: row.tone,
        audience: row.audience,
        preferredLanguage: row.preferredLanguage,
        wordsToUse: JSON.parse(row.wordsToUseJson),
        wordsToAvoid: JSON.parse(row.wordsToAvoidJson),
        styleGuidance: row.styleGuidance,
        exampleCopy: row.exampleCopy,
      });
      return { profile };
    },
  };
}
