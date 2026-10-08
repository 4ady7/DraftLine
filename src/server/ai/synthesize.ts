import type {
  BrandProfileInput,
  DraftOutput,
  EditorialOutput,
  OutlineOutput,
  RepurposeOutput,
  ResearchModelOutput,
  ResearchOutput,
  SearchResult,
} from "@/domain/schemas";
import { slugify, trimAtWord } from "@/domain/text";
import { demoPackage } from "@/server/demo/catalog";

type BriefShape = {
  title: string;
  rawBrief: string;
  audience: string;
  contentGoal: string;
  category: string;
};

export function synthesizeResearch(sources: SearchResult[], brief: BriefShape): ResearchModelOutput {
  const summary = sources.some((source) => source.id === "submitted-brief")
    ? `Demo mode has no external sources for this topic. The only material on file is the submitted brief, “${brief.title}”. Treat every claim from it as unverified until a live search is run.`
    : `${sources.length} corpus sources are attached for “${brief.title.replace(/\.$/, "")}”. One figure is included only so it can be checked before publication. Nothing here was fetched from the public web.`;

  return {
    summary,
    sourceUrls: sources.map((source) => source.url),
    findings: sources.map((source) => ({
      text: source.excerpt,
      sourceUrls: [source.url],
      relevance: source.relevance,
    })),
    claims: sources.map((source, index) => ({
      id: `claim-${index + 1}`,
      text: source.demoClaim || source.excerpt,
      sourceUrl: source.url,
      verification: source.demoVerification ?? "UNVERIFIED",
    })),
  };
}

export function synthesizeOutline(input: { brief: BriefShape; research: ResearchOutput }): OutlineOutput {
  const pack = demoPackage(input.brief.category);
  const urls = new Set(input.research.sources.map((source) => source.url));
  const claimsByUrl = new Map<string, string[]>();
  for (const claim of input.research.claims) {
    if (!claim.sourceUrl) continue;
    const list = claimsByUrl.get(claim.sourceUrl) ?? [];
    list.push(claim.text);
    claimsByUrl.set(claim.sourceUrl, list);
  }

  if (!pack) {
    const findings = input.research.findings.slice(0, 4);
    return {
      workingTitle: trimAtWord(input.brief.title, 180),
      thesis: trimAtWord(input.research.summary, 700),
      audience: input.brief.audience,
      sections: [
        sectionFrom("limits", "What this pass can support", "State the limit of the available material before making the argument.", findings[0]?.text ?? input.brief.contentGoal, findings[0]?.sourceUrls ?? [], 160),
        sectionFrom("argument", "The argument the brief is asking for", input.brief.contentGoal, input.brief.contentGoal, findings[1]?.sourceUrls ?? [], 180),
        sectionFrom("reader", "What the reader should do next", "Give the reader a next step that does not depend on invented evidence.", input.brief.audience, findings[2]?.sourceUrls ?? [], 140),
      ],
    };
  }

  const sourceById = new Map(pack.corpus.map((source) => [source.id, source.url]));
  return {
    workingTitle: pack.outline.workingTitle,
    thesis: pack.outline.thesis,
    audience: input.brief.audience,
    sections: pack.outline.sections.map((section) => {
      const evidenceRefs = section.evidenceSourceIds
        .map((id) => sourceById.get(id))
        .filter((url): url is string => Boolean(url && urls.has(url)));
      const claimPoints = evidenceRefs.flatMap((url) => claimsByUrl.get(url) ?? []);
      const keyPoints = unique([section.bridge, ...claimPoints]).slice(0, 4);
      return {
        id: section.id,
        heading: section.heading,
        purpose: section.purpose,
        keyPoints: keyPoints.length > 0 ? keyPoints : [section.bridge],
        evidenceRefs,
        wordAllocation: section.wordAllocation,
      };
    }),
  };
}

function sectionFrom(id: string, heading: string, purpose: string, point: string, evidenceRefs: string[], words: number) {
  return {
    id,
    heading,
    purpose,
    keyPoints: [point],
    evidenceRefs,
    wordAllocation: words,
  };
}

export function synthesizeDraft(input: {
  brief: BriefShape;
  research: ResearchOutput;
  outline: OutlineOutput;
  brand: BrandProfileInput | null;
}): DraftOutput {
  const claims = input.research.claims;
  const blocks: DraftOutput["blocks"] = [
    {
      id: "intro",
      kind: "paragraph",
      text: input.outline.thesis,
      provenance: "MODEL_GENERATED",
      sourceUrls: [],
    },
  ];

  input.outline.sections.forEach((section, sectionIndex) => {
    blocks.push({
      id: `${section.id}-heading`,
      kind: "heading",
      text: section.heading,
      provenance: "MODEL_GENERATED",
      sourceUrls: [],
    });
    blocks.push({
      id: `${section.id}-purpose`,
      kind: "paragraph",
      text: section.purpose,
      provenance: "MODEL_GENERATED",
      sourceUrls: [],
    });
    section.keyPoints.forEach((point, pointIndex) => {
      const claim = claims.find((item) => item.text === point);
      const provenance = !claim ? "MODEL_GENERATED" : claim.verification === "SOURCE_GROUNDED" ? "SOURCE_GROUNDED" : "UNVERIFIED";
      blocks.push({
        id: `${section.id}-p-${sectionIndex}-${pointIndex}`,
        kind: "paragraph",
        text: point,
        provenance,
        sourceUrls: claim?.sourceUrl ? [claim.sourceUrl] : [],
      });
    });
  });

  const cta = input.brand
    ? `${input.brand.brandName} can walk through this with ${input.brief.audience.toLowerCase()} against the actual close, scope, or repository — not a generic demo.`
    : `The next useful step is a working session on ${input.brief.contentGoal.charAt(0).toLowerCase()}${input.brief.contentGoal.slice(1)}`;

  blocks.push({
    id: "cta",
    kind: "paragraph",
    text: input.brand ? input.brand.exampleCopy : cta,
    provenance: input.brand ? "BRAND_GUIDANCE" : "MODEL_GENERATED",
    sourceUrls: [],
  });

  const keywords = keywordsFrom(input.brief.title, input.outline.workingTitle);
  return {
    title: input.outline.workingTitle,
    cta: trimAtWord(cta, 320),
    seo: {
      title: trimAtWord(input.outline.workingTitle, 70).replace(/…$/, ""),
      description: trimAtWord(input.outline.thesis, 170).replace(/…$/, ""),
      keywords,
      slug: slugify(input.outline.workingTitle),
    },
    blocks,
  };
}

export function synthesizeEditorial(): EditorialOutput["findings"] {
  return [];
}

export function synthesizeRepurpose(input: {
  brief: BriefShape;
  draft: DraftOutput;
  editorial: EditorialOutput;
  brand: BrandProfileInput | null;
}): RepurposeOutput {
  const banned = input.editorial.findings.filter((finding) => finding.severity === "high").map((finding) => finding.affectedExcerpt);
  const grounded = input.draft.blocks.find(
    (block) =>
      block.kind === "paragraph" &&
      block.provenance === "SOURCE_GROUNDED" &&
      !banned.some((excerpt) => excerpt && (block.text.includes(excerpt) || excerpt.includes(block.text))),
  );
  const evidence = grounded?.text ?? input.draft.blocks.find((block) => block.kind === "paragraph" && block.provenance === "MODEL_GENERATED")?.text ?? input.draft.title;
  const voice = input.brand?.brandName ?? "the team";
  const linkedin = [
    input.draft.title,
    "",
    evidence,
    "",
    `If you own this for ${input.brief.audience.toLowerCase()}, the useful question is not whether the tool is impressive. It is which decision you still have to make yourself.`,
    "",
    `${voice} wrote the long version for people who have to defend the choice.`,
  ].join("\n");

  const linkedinShort = `${input.draft.title}\n\n${trimAtWord(evidence, 280)}\n\nThe long version is for the person who has to sign.`;
  const x = trimAtWord(`${input.draft.title} — ${evidence}`, 270);
  const newsletter = `${input.brief.audience} keep getting a shorter version of this argument than the decision deserves.\n\n${trimAtWord(evidence, 320)}\n\nThe essay is the longer account, including the figure we are not willing to publish yet.`;
  const summary = [`For: ${input.brief.audience}`, `Ask: ${input.brief.contentGoal}`, `Point: ${trimAtWord(evidence, 280)}`].join("\n");

  return {
    linkedin: { purpose: "A post for operators who will not open the article first.", body: trimAtWord(linkedin, 1800), provenance: "MODEL_GENERATED" },
    linkedinShort: { purpose: "A shorter post that makes one point and stops.", body: trimAtWord(linkedinShort, 700), provenance: "MODEL_GENERATED" },
    x: { purpose: "One observation, short enough to post without a thread.", body: x, provenance: "MODEL_GENERATED" },
    newsletterIntro: { purpose: "Open a newsletter with the stakes, then point at the essay.", body: trimAtWord(newsletter, 1800), provenance: "MODEL_GENERATED" },
    summary: { purpose: "A skim for someone forwarding the package internally.", body: trimAtWord(summary, 1800), provenance: "MODEL_GENERATED" },
  };
}

function keywordsFrom(title: string, working: string): string[] {
  const words = `${title} ${working}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);
  const uniqueWords = unique(words).slice(0, 4);
  while (uniqueWords.length < 2) uniqueWords.push(uniqueWords.length === 0 ? "briefing" : "editorial");
  return uniqueWords;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
