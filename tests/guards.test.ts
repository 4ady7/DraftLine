import { describe, expect, it } from "vitest";
import type { DraftOutput, OutlineOutput, ResearchOutput, SearchResult } from "@/domain/schemas";
import { overlapsExcerpt } from "@/domain/text";
import { assertRepurposeClean, constrainResearch, groundDraft } from "@/server/agents/guards";
import { heuristicFindings } from "@/server/agents/heuristics";
import { DEMO_PACKAGES } from "@/server/demo/catalog";
import { MalformedModelOutputError } from "@/server/errors";

const retrievedAt = "2026-10-08T12:00:00.000Z";

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "src-1",
    url: "https://demo.draftline.local/corpus/example",
    title: "Example note",
    publisher: "Draftline demo corpus",
    excerpt: "Spreadsheet close turns reconciliation and review into a queue that surfaces slippage only at month end.",
    relevance: "Relevant to the brief.",
    retrievedAt,
    provider: "demo-corpus",
    ...overrides,
  };
}

describe("demo corpus claims", () => {
  it("keeps source-grounded claims inside the excerpt they cite", () => {
    for (const pack of Object.values(DEMO_PACKAGES)) {
      for (const source of pack.corpus) {
        if (source.verification !== "SOURCE_GROUNDED") continue;
        expect(overlapsExcerpt(source.claim, source.excerpt), `${pack.id} ${source.id}`).toBe(true);
      }
    }
  });
});

describe("research provenance guard", () => {
  it("keeps tool metadata and refuses a source the tool did not return", () => {
    expect(() =>
      constrainResearch(
        {
          summary: "A summary of the retrieved note.",
          sourceUrls: ["https://example.com/not-retrieved"],
          findings: [{ text: "A finding.", sourceUrls: ["https://example.com/not-retrieved"], relevance: "high" }],
          claims: [{ id: "c1", text: "A claim that was not retrieved.", sourceUrl: "https://example.com/not-retrieved", verification: "SOURCE_GROUNDED" }],
        },
        [source()],
      ),
    ).toThrow(MalformedModelOutputError);
  });

  it("downgrades a grounded claim that does not overlap the excerpt", () => {
    const output = constrainResearch(
      {
        summary: "The note describes the close as a queue.",
        sourceUrls: [source().url],
        findings: [{ text: source().excerpt, sourceUrls: [source().url], relevance: "direct" }],
        claims: [{ id: "c1", text: "Teams save forty percent in the first quarter.", sourceUrl: source().url, verification: "SOURCE_GROUNDED" }],
      },
      [source()],
    );
    expect(output.sources[0]?.publisher).toBe("Draftline demo corpus");
    expect(output.sources[0]?.excerpt).toBe(source().excerpt);
    expect(output.claims[0]?.verification).toBe("SOURCE_SUPPORT_UNCLEAR");
    expect(output.claims[0]?.provenance).toBe("UNVERIFIED");
  });

  it("refuses a source whose URL is not http or https", () => {
    const retrieved = source({ url: "javascript:alert(1)" });
    expect(() =>
      constrainResearch(
        {
          summary: "A summary of the retrieved note.",
          sourceUrls: [retrieved.url],
          findings: [{ text: retrieved.excerpt, sourceUrls: [retrieved.url], relevance: "direct" }],
          claims: [{ id: "c1", text: retrieved.excerpt, sourceUrl: retrieved.url, verification: "SOURCE_GROUNDED" }],
        },
        [retrieved],
      ),
    ).toThrow(MalformedModelOutputError);
  });

  it("refuses duplicate claim ids", () => {
    const retrieved = source();
    expect(() =>
      constrainResearch(
        {
          summary: "A summary of the retrieved note.",
          sourceUrls: [retrieved.url],
          findings: [{ text: retrieved.excerpt, sourceUrls: [retrieved.url], relevance: "direct" }],
          claims: [
            { id: "c1", text: retrieved.excerpt, sourceUrl: retrieved.url, verification: "SOURCE_GROUNDED" },
            { id: "c1", text: retrieved.excerpt, sourceUrl: retrieved.url, verification: "UNVERIFIED" },
          ],
        },
        [retrieved],
      ),
    ).toThrow(MalformedModelOutputError);
  });
});

describe("downstream provenance guards", () => {
  it("downgrades a grounded paragraph that is not a grounded claim", () => {
    const research = {
      summary: "Summary",
      sources: [source()],
      findings: [],
      claims: [
        {
          id: "c1",
          text: source().excerpt,
          sourceUrl: source().url,
          verification: "SOURCE_GROUNDED" as const,
          provenance: "SOURCE_GROUNDED" as const,
        },
      ],
    };
    const draft = {
      title: "Title",
      cta: "",
      seo: { title: "Title", description: "A description of the close.", keywords: ["close", "queue"], slug: "title" },
      blocks: [
        { id: "b1", kind: "paragraph" as const, text: source().excerpt, provenance: "SOURCE_GROUNDED" as const, sourceUrls: [source().url] },
        { id: "b2", kind: "paragraph" as const, text: "An invented savings figure of 40 percent.", provenance: "SOURCE_GROUNDED" as const, sourceUrls: [source().url] },
        { id: "b3", kind: "heading" as const, text: "The close", provenance: "MODEL_GENERATED" as const, sourceUrls: [] },
        { id: "b4", kind: "paragraph" as const, text: "The rest of the argument.", provenance: "MODEL_GENERATED" as const, sourceUrls: [] },
      ],
    };
    const grounded = groundDraft(draft, research);
    expect(grounded.draft.blocks[0]?.provenance).toBe("SOURCE_GROUNDED");
    expect(grounded.draft.blocks[1]?.provenance).toBe("UNVERIFIED");
    expect(grounded.downgraded).toBe(1);
  });

  it("rejects a derivative that repeats a held-back figure", () => {
    const editorial = {
      verdict: "NEEDS_REVISION" as const,
      findings: [
        {
          id: "f1",
          severity: "high" as const,
          category: "needs_current_data",
          summary: "Check the figure.",
          affectedExcerpt: "The median close is 8.5 business days.",
          suggestion: "Verify it.",
          verificationFlag: "NEEDS_CURRENT_DATA",
          origin: "rule" as const,
        },
      ],
    };
    const clean = {
      linkedin: { purpose: "One point.", body: "The close is a queue.", provenance: "MODEL_GENERATED" as const },
      linkedinShort: { purpose: "Shorter.", body: "The close is a queue.", provenance: "MODEL_GENERATED" as const },
      x: { purpose: "Short.", body: "The close is a queue.", provenance: "MODEL_GENERATED" as const },
      newsletterIntro: { purpose: "Open.", body: "The close is a queue.", provenance: "MODEL_GENERATED" as const },
      summary: { purpose: "Skim.", body: "The close is a queue.", provenance: "MODEL_GENERATED" as const },
    };
    expect(() => assertRepurposeClean(clean, editorial)).not.toThrow();
    expect(() => assertRepurposeClean({ ...clean, x: { ...clean.x, body: "Median close: 8.5 days." } }, editorial)).toThrow(MalformedModelOutputError);
  });
});

describe("editorial heuristics", () => {
  it("flags a current-data claim and a banned brand phrase", () => {
    const research = {
      summary: "Summary",
      sources: [],
      findings: [],
      claims: [
        {
          id: "c1",
          text: "A 2024 operating survey puts the median mid-market close at 8.5 business days.",
          sourceUrl: "https://demo.draftline.local/corpus/northwind/cited-median",
          verification: "NEEDS_CURRENT_DATA" as const,
          provenance: "UNVERIFIED" as const,
        },
      ],
    } as unknown as ResearchOutput;
    const outline = {
      workingTitle: "Title",
      thesis: "Thesis",
      audience: "Controllers",
      sections: [
        { id: "s1", heading: "The close is a queue", purpose: "Name it.", keyPoints: ["Point"], evidenceRefs: ["https://demo.draftline.local/a"], wordAllocation: 100 },
      ],
    } as OutlineOutput;
    const draft = {
      title: "A seamless close",
      cta: "",
      seo: { title: "Title", description: "Description long enough", keywords: ["close", "queue"], slug: "title" },
      blocks: [
        { id: "b1", kind: "paragraph", text: "A 2024 operating survey puts the median mid-market close at 8.5 business days.", provenance: "UNVERIFIED", sourceUrls: [] },
        { id: "b2", kind: "heading", text: "The close is a queue", provenance: "MODEL_GENERATED", sourceUrls: [] },
        { id: "b3", kind: "paragraph", text: "This seamless platform will revolutionize the close.", provenance: "MODEL_GENERATED", sourceUrls: [] },
        { id: "b4", kind: "paragraph", text: "Judgment stays with a named owner.", provenance: "MODEL_GENERATED", sourceUrls: [] },
      ],
    } as DraftOutput;
    const findings = heuristicFindings({
      draft,
      research,
      outline,
      brand: {
        brandName: "Northwind",
        tone: "Calm",
        audience: "Controllers",
        preferredLanguage: "en",
        wordsToUse: [],
        wordsToAvoid: ["seamless"],
        styleGuidance: "Be specific.",
        exampleCopy: "Example.",
      },
    });
    expect(findings.some((finding) => finding.verificationFlag === "NEEDS_CURRENT_DATA")).toBe(true);
    expect(findings.some((finding) => finding.category === "brand_alignment")).toBe(true);
  });
});
