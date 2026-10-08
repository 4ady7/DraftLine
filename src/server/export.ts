import type { RunView, StageView } from "@/domain/dto";
import type { DraftOutput, EditorialOutput, OutlineOutput, RepurposeOutput, ResearchOutput } from "@/domain/schemas";
import { blocksToMarkdown } from "@/domain/text";

export type ExportDocument = {
  exportedAt: string;
  runId: string;
  state: string;
  mode: string;
  project: string;
  brief: RunView["brief"];
  omitted: Array<{ stage: string; reason: string }>;
  research: { summary: string; sources: ResearchOutput["sources"]; claims: ResearchOutput["claims"] } | null;
  outline: OutlineOutput | null;
  article: { title: string; markdown: string; cta: string; seo: DraftOutput["seo"]; blocks: DraftOutput["blocks"] } | null;
  editorial: EditorialOutput | null;
  repurpose: RepurposeOutput | null;
  humanEdits: RunView["edits"];
};

export function buildExport(run: RunView): ExportDocument {
  const omitted: ExportDocument["omitted"] = [];
  const take = <T>(stage: StageView, label: string): T | null => {
    if (!stage.output) {
      omitted.push({ stage: label, reason: "This stage has no approved output yet." });
      return null;
    }
    if (stage.stale) {
      omitted.push({ stage: label, reason: stage.staleReason ?? "This stage is stale and was left out of the current package." });
      return null;
    }
    if (stage.status !== "APPROVED" && stage.status !== "COMPLETED") {
      omitted.push({ stage: label, reason: `This stage is ${stage.status.toLowerCase().replaceAll("_", " ")} and is not part of the current package.` });
      return null;
    }
    return stage.output as T;
  };

  const researchStage = run.stages.find((stage) => stage.stage === "RESEARCH")!;
  const outlineStage = run.stages.find((stage) => stage.stage === "OUTLINE")!;
  const draftStage = run.stages.find((stage) => stage.stage === "DRAFT")!;
  const editorialStage = run.stages.find((stage) => stage.stage === "EDITORIAL")!;
  const repurposeStage = run.stages.find((stage) => stage.stage === "REPURPOSE")!;
  const research = take<ResearchOutput>(researchStage, "Research");
  const outline = take<OutlineOutput>(outlineStage, "Outline");
  const draft = take<DraftOutput>(draftStage, "Draft");
  const editorial = take<EditorialOutput>(editorialStage, "Editorial");
  const repurpose = take<RepurposeOutput>(repurposeStage, "Repurpose");

  return {
    exportedAt: new Date().toISOString(),
    runId: run.id,
    state: run.state,
    mode: run.mode,
    project: run.project.name,
    brief: run.brief,
    omitted,
    research: research ? { summary: research.summary, sources: research.sources, claims: research.claims } : null,
    outline,
    article: draft
      ? { title: draft.title, markdown: blocksToMarkdown(draft.blocks), cta: draft.cta ?? "", seo: draft.seo, blocks: draft.blocks }
      : null,
    editorial,
    repurpose,
    humanEdits: run.edits,
  };
}

export function toMarkdown(doc: ExportDocument): string {
  const lines: string[] = [`# ${doc.article?.title ?? doc.brief.title}`, ""];
  lines.push(`Project: ${doc.project}`);
  lines.push(`Run: ${doc.runId}`);
  lines.push(`State: ${doc.state}`);
  lines.push("");
  if (doc.omitted.length) {
    lines.push("## Not in this package");
    for (const item of doc.omitted) lines.push(`- ${item.stage}: ${item.reason}`);
    lines.push("");
  }
  if (doc.article) {
    lines.push(doc.article.markdown);
    lines.push("");
    if (doc.article.cta) {
      lines.push("## Call to action");
      lines.push(doc.article.cta);
      lines.push("");
    }
    lines.push("## SEO");
    lines.push(`- Title: ${doc.article.seo.title}`);
    lines.push(`- Description: ${doc.article.seo.description}`);
    lines.push(`- Slug: ${doc.article.seo.slug}`);
    lines.push(`- Keywords: ${doc.article.seo.keywords.join(", ")}`);
    lines.push("");
    lines.push("## Provenance in the article");
    for (const block of doc.article.blocks) {
      const sources = block.sourceUrls.length ? ` · ${block.sourceUrls.join(", ")}` : "";
      lines.push(`- ${block.kind}: ${block.provenance}${sources}`);
    }
    lines.push("");
  }
  if (doc.repurpose) {
    lines.push("## Derivative copy");
    for (const [name, variant] of Object.entries(doc.repurpose)) {
      lines.push(`### ${name}`);
      lines.push(variant.purpose);
      lines.push("");
      lines.push(variant.body);
      lines.push("");
    }
  }
  if (doc.research) {
    lines.push("## Sources");
    for (const source of doc.research.sources) {
      lines.push(`- ${source.title} (${source.publisher}, ${source.provider})`);
      lines.push(`  ${source.url}`);
      lines.push(`  Retrieved ${source.retrievedAt}`);
    }
    lines.push("");
    lines.push("## Claims");
    for (const claim of doc.research.claims) {
      lines.push(`- [${claim.verification}] ${claim.text}`);
    }
    lines.push("");
  }
  if (doc.editorial) {
    lines.push("## Editorial findings");
    lines.push(`Verdict: ${doc.editorial.verdict}`);
    for (const finding of doc.editorial.findings) {
      lines.push(`- ${finding.severity.toUpperCase()} · ${finding.summary}`);
      if (finding.verificationFlag) lines.push(`  Flag: ${finding.verificationFlag}`);
    }
    lines.push("");
  }
  if (doc.humanEdits.length) {
    lines.push("## Human edits");
    for (const edit of doc.humanEdits) lines.push(`- ${edit.stage} v${edit.version} · ${edit.fieldPath}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}
