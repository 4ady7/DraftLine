import type { DraftOutput, EditorialOutput, RepurposeOutput, ResearchModelOutput, ResearchOutput, SearchResult } from "@/domain/schemas";
import { researchOutputSchema } from "@/domain/schemas";
import { isPublicHttpUrl, overlapsExcerpt } from "@/domain/text";
import { MalformedModelOutputError } from "@/server/errors";

/**
 * Provenance firewall. Persisted sources are copies of tool results.
 * The model may select URLs and propose claims. It may not introduce a URL,
 * an excerpt, a publisher, or a retrieval time.
 */
export function constrainResearch(model: ResearchModelOutput, toolResults: SearchResult[]): ResearchOutput {
  if (toolResults.some((result) => !isPublicHttpUrl(result.url))) {
    throw new MalformedModelOutputError("A retrieved source did not use an http or https URL.");
  }
  const claimIds = new Set<string>();
  for (const claim of model.claims) {
    if (claimIds.has(claim.id)) throw new MalformedModelOutputError("The model returned two claims with the same id.");
    claimIds.add(claim.id);
  }
  const byUrl = new Map(toolResults.map((result) => [result.url, result]));
  for (const url of model.sourceUrls) {
    if (!byUrl.has(url)) {
      throw new MalformedModelOutputError("The model cited a source that was not retrieved.");
    }
  }

  const selected = model.sourceUrls.map((url) => byUrl.get(url)!);
  const sources = selected.map((result) => ({
    id: result.id,
    url: result.url,
    title: result.title,
    publisher: result.publisher,
    retrievedAt: result.retrievedAt,
    excerpt: result.excerpt,
    relevance: result.relevance,
    provider: result.provider,
  }));

  const findings = model.findings.map((finding) => {
    for (const url of finding.sourceUrls) {
      if (!byUrl.has(url)) throw new MalformedModelOutputError("A finding cites a source that was not retrieved.");
    }
    return finding;
  });

  const claims = model.claims.map((claim) => {
    if (claim.sourceUrl && !byUrl.has(claim.sourceUrl)) {
      throw new MalformedModelOutputError("A claim cites a source that was not retrieved.");
    }
    let verification = claim.verification;
    if (verification === "SOURCE_GROUNDED") {
      const source = claim.sourceUrl ? byUrl.get(claim.sourceUrl) : undefined;
      if (!source || !overlapsExcerpt(claim.text, source.excerpt)) verification = "SOURCE_SUPPORT_UNCLEAR";
    }
    return {
      ...claim,
      verification,
      provenance: verification === "SOURCE_GROUNDED" ? ("SOURCE_GROUNDED" as const) : ("UNVERIFIED" as const),
    };
  });

  const output = { summary: model.summary, sources, findings, claims };
  const parsed = researchOutputSchema.safeParse(output);
  if (!parsed.success) throw new MalformedModelOutputError(parsed.error.issues[0]?.message ?? "Research output was invalid.");
  return parsed.data;
}

export function knownEvidence(research: ResearchOutput): Set<string> {
  const refs = new Set<string>();
  for (const source of research.sources) refs.add(source.url);
  for (const claim of research.claims) refs.add(claim.id);
  return refs;
}

export function groundDraft(draft: DraftOutput, research: ResearchOutput): { draft: DraftOutput; downgraded: number } {
  const urls = new Set(research.sources.map((source) => source.url));
  let downgraded = 0;
  const blocks = draft.blocks.map((block) => {
    const sourceUrls = block.sourceUrls.filter((url) => urls.has(url));
    if (block.provenance !== "SOURCE_GROUNDED") return { ...block, sourceUrls };
    const grounded = research.claims.some(
      (claim) =>
        claim.verification === "SOURCE_GROUNDED" &&
        claim.provenance === "SOURCE_GROUNDED" &&
        Boolean(claim.sourceUrl && sourceUrls.includes(claim.sourceUrl)) &&
        (claim.text === block.text || overlapsExcerpt(block.text, claim.text)),
    );
    if (grounded) return { ...block, sourceUrls };
    downgraded += 1;
    return { ...block, provenance: "UNVERIFIED" as const, sourceUrls };
  });
  return { draft: { ...draft, blocks }, downgraded };
}

export function assertRepurposeClean(output: RepurposeOutput, editorial: EditorialOutput): void {
  const risky = editorial.findings.filter((finding) => finding.severity === "high");
  const bodies = [output.linkedin.body, output.linkedinShort.body, output.x.body, output.newsletterIntro.body, output.summary.body];
  for (const finding of risky) {
    const numbers = finding.affectedExcerpt.match(/\d+\.\d+|\d+\s*percent|\d+%/gi) ?? [];
    for (const body of bodies) {
      if (finding.affectedExcerpt.length >= 12 && body.includes(finding.affectedExcerpt)) {
        throw new MalformedModelOutputError("A derivative repeated a high-severity excerpt.");
      }
      if (numbers.some((token) => body.includes(token))) {
        throw new MalformedModelOutputError("A derivative repeated a figure the editorial check held back.");
      }
    }
  }
}

export function filterEvidenceRefs(refs: string[], allowed: Set<string>): { kept: string[]; removed: number } {
  const kept = refs.filter((ref) => allowed.has(ref));
  return { kept, removed: refs.length - kept.length };
}
