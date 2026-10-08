import type { ResearchModelOutput, ResearchOutput, SearchResult } from "@/domain/schemas";
import { researchOutputSchema } from "@/domain/schemas";
import { overlapsExcerpt } from "@/domain/text";
import { MalformedModelOutputError } from "@/server/errors";

/**
 * Provenance firewall. Persisted sources are copies of tool results.
 * The model may select URLs and propose claims. It may not introduce a URL,
 * an excerpt, a publisher, or a retrieval time.
 */
export function constrainResearch(model: ResearchModelOutput, toolResults: SearchResult[]): ResearchOutput {
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

export function filterEvidenceRefs(refs: string[], allowed: Set<string>): { kept: string[]; removed: number } {
  const kept = refs.filter((ref) => allowed.has(ref));
  return { kept, removed: refs.length - kept.length };
}
