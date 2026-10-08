import type { BrandProfileInput, DraftOutput, EditorialOutput, OutlineOutput, ResearchOutput } from "@/domain/schemas";
import { blocksToMarkdown, containsPhrase } from "@/domain/text";

const AI_PHRASES = ["in today's rapidly", "delve", "it's important to note", "ever-evolving", "robust landscape"];

export function deriveVerdict(findings: EditorialOutput["findings"]): EditorialOutput["verdict"] {
  if (findings.some((finding) => finding.severity === "high")) return "NEEDS_REVISION";
  if (findings.length > 0) return "PASS_WITH_FLAGS";
  return "PASS";
}

export function heuristicFindings(input: {
  draft: DraftOutput;
  research: ResearchOutput;
  outline: OutlineOutput;
  brand: BrandProfileInput | null;
}): EditorialOutput["findings"] {
  const findings: EditorialOutput["findings"] = [];
  const article = blocksToMarkdown(input.draft.blocks);
  let index = 1;

  const push = (finding: Omit<EditorialOutput["findings"][number], "id" | "origin">) => {
    findings.push({ ...finding, id: `rule-${index++}`, origin: "rule" });
  };

  for (const claim of input.research.claims) {
    if (claim.verification === "SOURCE_GROUNDED") continue;
    const used = article.includes(claim.text) || input.draft.blocks.some((block) => block.sourceUrls.includes(claim.sourceUrl ?? "___"));
    if (!used) continue;
    const flag = claim.verification === "NEEDS_CURRENT_DATA" ? "NEEDS_CURRENT_DATA" : claim.verification === "SOURCE_SUPPORT_UNCLEAR" ? "SOURCE_SUPPORT_UNCLEAR" : "UNVERIFIED";
    push({
      severity: "high",
      category: flag === "NEEDS_CURRENT_DATA" ? "needs_current_data" : "unsupported_claim",
      summary:
        flag === "NEEDS_CURRENT_DATA"
          ? "A statistic in the draft was marked as needing a current primary source."
          : "The draft uses a claim that research did not mark as source-grounded.",
      affectedExcerpt: claim.text.slice(0, 500),
      suggestion: "Confirm the claim against a primary source, or take it out before publication.",
      verificationFlag: flag,
    });
  }

  for (const section of input.outline.sections) {
    if (!article.toLowerCase().includes(section.heading.toLowerCase())) {
      push({
        severity: "medium",
        category: "structure",
        summary: `The approved outline section “${section.heading}” does not appear in the draft.`,
        affectedExcerpt: section.heading,
        suggestion: "Restore the section or change the approved outline before this draft moves on.",
        verificationFlag: null,
      });
    }
    if (section.evidenceRefs.length === 0) {
      push({
        severity: "medium",
        category: "missing_evidence",
        summary: `“${section.heading}” has no evidence references.`,
        affectedExcerpt: section.heading,
        suggestion: "Attach a source from the approved research, or mark the section as argument rather than evidence.",
        verificationFlag: "SOURCE_SUPPORT_UNCLEAR",
      });
    }
  }

  const sentences = article
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40);
  const seen = new Map<string, string>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    const prior = seen.get(key);
    if (prior) {
      push({
        severity: "low",
        category: "repetition",
        summary: "A sentence is repeated in the draft.",
        affectedExcerpt: sentence.slice(0, 500),
        suggestion: "Cut the repeated sentence.",
        verificationFlag: null,
      });
      break;
    }
    seen.set(key, sentence);
  }

  for (const phrase of AI_PHRASES) {
    if (article.toLowerCase().includes(phrase)) {
      push({
        severity: "medium",
        category: "ai_style",
        summary: `The draft uses the stock phrase “${phrase}”.`,
        affectedExcerpt: phrase,
        suggestion: "Replace it with a concrete sentence from the brief or the research.",
        verificationFlag: null,
      });
    }
  }

  for (const phrase of input.brand?.wordsToAvoid ?? []) {
    if (containsPhrase(article, phrase) || containsPhrase(input.draft.title, phrase)) {
      push({
        severity: "medium",
        category: "brand_alignment",
        summary: `The draft uses “${phrase}”, which this brand profile says to avoid.`,
        affectedExcerpt: phrase,
        suggestion: "Rewrite the sentence without that phrase.",
        verificationFlag: null,
      });
    }
  }

  return findings;
}
