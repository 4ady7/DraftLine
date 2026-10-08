import { z } from "zod";

export const verificationSchema = z.enum([
  "SOURCE_GROUNDED",
  "UNVERIFIED",
  "NEEDS_CURRENT_DATA",
  "SOURCE_SUPPORT_UNCLEAR",
]);

export const provenanceSchema = z.enum([
  "SOURCE_GROUNDED",
  "BRAND_GUIDANCE",
  "MODEL_GENERATED",
  "HUMAN_EDITED",
  "UNVERIFIED",
]);

export const stageSchema = z.enum(["RESEARCH", "OUTLINE", "DRAFT", "EDITORIAL", "REPURPOSE"]);

export const providerSchema = z.enum(["demo-corpus", "tavily"]);

export const metaSchema = z.object({
  humanEdited: z.boolean(),
  editedFields: z.array(z.string()),
});

export const researchModelSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  sourceUrls: z.array(z.string().url()).min(1).max(12),
  findings: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(1000),
        sourceUrls: z.array(z.string().url()).min(1).max(4),
        relevance: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(20),
  claims: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(800),
        sourceUrl: z.string().url().nullable(),
        verification: verificationSchema,
      }),
    )
    .min(1)
    .max(30),
});

export const sourceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  url: z.string().url().max(500),
  title: z.string().trim().min(1).max(300),
  publisher: z.string().trim().min(1).max(200),
  retrievedAt: z.string().datetime(),
  excerpt: z.string().trim().min(1).max(2000),
  relevance: z.string().trim().min(1).max(500),
  provider: providerSchema,
});

export const researchOutputSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  sources: z.array(sourceSchema).min(1).max(12),
  findings: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(1000),
        sourceUrls: z.array(z.string().url()).min(1).max(4),
        relevance: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(20),
  claims: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(800),
        sourceUrl: z.string().url().nullable(),
        verification: verificationSchema,
        provenance: provenanceSchema,
      }),
    )
    .min(1)
    .max(30),
});

export const outlineOutputSchema = z.object({
  workingTitle: z.string().trim().min(1).max(200),
  thesis: z.string().trim().min(1).max(800),
  audience: z.string().trim().min(1).max(300),
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        heading: z.string().trim().min(1).max(200),
        purpose: z.string().trim().min(1).max(500),
        keyPoints: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
        evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(8),
        wordAllocation: z.number().int().min(40).max(800),
      }),
    )
    .min(3)
    .max(8),
});

export const draftBlockSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.enum(["heading", "paragraph"]),
  text: z.string().trim().min(1).max(3000),
  provenance: provenanceSchema,
  sourceUrls: z.array(z.string().url()).max(4),
});

export const seoSchema = z.object({
  title: z.string().trim().min(1).max(70),
  description: z.string().trim().min(1).max(180),
  keywords: z.array(z.string().trim().min(1).max(40)).min(2).max(8),
  slug: z.string().trim().min(1).max(80),
});

export const draftOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  cta: z.string().trim().max(400).optional().default(""),
  seo: seoSchema,
  blocks: z.array(draftBlockSchema).min(4).max(80),
});

export const editorialOutputSchema = z.object({
  verdict: z.enum(["PASS", "PASS_WITH_FLAGS", "NEEDS_REVISION"]),
  findings: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        severity: z.enum(["low", "medium", "high"]),
        category: z.string().trim().min(1).max(80),
        summary: z.string().trim().min(1).max(500),
        affectedExcerpt: z.string().trim().min(1).max(500),
        suggestion: z.string().trim().min(1).max(500),
        verificationFlag: z.string().trim().max(80).nullable(),
        origin: z.enum(["rule", "model"]),
      }),
    )
    .max(40),
});

export const variantSchema = z.object({
  purpose: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  provenance: provenanceSchema,
});

export const repurposePackageSchema = z
  .object({
    linkedin: variantSchema,
    linkedinShort: variantSchema,
    x: variantSchema,
    newsletterIntro: variantSchema,
    summary: variantSchema,
  })
  .superRefine((value, ctx) => {
    if (value.x.body.length > 280) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["x", "body"], message: "X variant must be 280 characters or fewer." });
    }
  });

export const brandSchema = z.object({
  brandName: z.string().trim().min(1).max(120),
  tone: z.string().trim().min(1).max(300),
  audience: z.string().trim().min(1).max(300),
  preferredLanguage: z.string().trim().min(2).max(20),
  wordsToUse: z.array(z.string().trim().min(1).max(40)).max(20),
  wordsToAvoid: z.array(z.string().trim().min(1).max(40)).max(20),
  styleGuidance: z.string().trim().min(1).max(1000),
  exampleCopy: z.string().trim().min(1).max(600),
});

export const searchResultSchema = z.object({
  id: z.string().min(1).max(80),
  url: z.string().url(),
  title: z.string().min(1).max(300),
  publisher: z.string().min(1).max(200),
  excerpt: z.string().min(1).max(2000),
  relevance: z.string().min(1).max(500),
  retrievedAt: z.string().datetime(),
  provider: providerSchema,
  demoClaim: z.string().max(800).optional(),
  demoVerification: verificationSchema.optional(),
});

export const searchOutputSchema = z.object({
  query: z.string(),
  provider: providerSchema,
  results: z.array(searchResultSchema).max(8),
});

export const createRunSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("demo"),
    demoId: z.enum(["northwind-close", "hale-retainer", "relay-agents"]),
    mode: z.enum(["mock", "live"]),
  }),
  z.object({
    kind: z.literal("custom"),
    mode: z.enum(["mock", "live"]),
    projectName: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    rawBrief: z.string().trim().min(20).max(8000),
    audience: z.string().trim().min(1).max(300),
    contentGoal: z.string().trim().min(1).max(500),
    brand: brandSchema.optional(),
  }),
]);

export const faultTypeSchema = z.enum(["ai_timeout", "search_timeout", "malformed_output", "database_failure"]);

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("kick") }),
  z.object({
    action: z.literal("approve"),
    stage: stageSchema,
    expectedRevision: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("reject"),
    stage: stageSchema,
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("edit"),
    stage: stageSchema,
    expectedRevision: z.number().int().positive(),
    content: z.custom<unknown>((value) => value !== undefined),
  }),
  z.object({ action: z.literal("regenerate"), stage: stageSchema }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("simulate"),
    stage: stageSchema,
    fault: faultTypeSchema,
    times: z.number().int().min(1).max(5),
  }),
]);

export const researchEditSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  claims: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(800),
      }),
    )
    .max(30),
});

export const outlineEditSchema = z.object({
  workingTitle: z.string().trim().min(1).max(200),
  thesis: z.string().trim().min(1).max(800),
  audience: z.string().trim().min(1).max(300),
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        heading: z.string().trim().min(1).max(200),
        purpose: z.string().trim().min(1).max(500),
        keyPoints: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
        wordAllocation: z.number().int().min(40).max(800),
      }),
    )
    .min(3)
    .max(8),
});

export const draftEditSchema = z.object({
  title: z.string().trim().min(1).max(200),
  cta: z.string().trim().max(400).optional().default(""),
  article: z.string().trim().min(1).max(30000),
  seo: seoSchema,
});

export const repurposeEditSchema = z.object({
  linkedin: z.string().trim().min(1).max(2000),
  linkedinShort: z.string().trim().min(1).max(2000),
  x: z.string().trim().min(1).max(280),
  newsletterIntro: z.string().trim().min(1).max(2000),
  summary: z.string().trim().min(1).max(2000),
});

export type ResearchModelOutput = z.infer<typeof researchModelSchema>;
export type ResearchOutput = z.infer<typeof researchOutputSchema>;
export type OutlineOutput = z.infer<typeof outlineOutputSchema>;
export type DraftOutput = z.infer<typeof draftOutputSchema>;
export type EditorialOutput = z.infer<typeof editorialOutputSchema>;
export type RepurposeOutput = z.infer<typeof repurposePackageSchema>;
export type BrandProfileInput = z.infer<typeof brandSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
