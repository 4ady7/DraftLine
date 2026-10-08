import type { Prisma } from "@prisma/client";
import type { StageName } from "@/domain/stages";
import {
  draftEditSchema,
  outlineEditSchema,
  repurposeEditSchema,
  researchEditSchema,
  type DraftOutput,
  type OutlineOutput,
  type RepurposeOutput,
  type ResearchOutput,
} from "@/domain/schemas";
import { markdownToBlocks } from "@/domain/text";
import { AppError, LostRaceError } from "@/server/errors";
import { parseStored, withMeta } from "@/server/workflow/dto";

export async function applyEdit(
  tx: Prisma.TransactionClient,
  args: {
    runId: string;
    stage: StageName;
    executionId: string;
    outputJson: string | null;
    content: unknown;
    expectedRevision: number;
    fromStatus: string;
    nextStatus?: string;
  },
): Promise<{ changed: string[] }> {
  const parsed = parseStored(args.stage, args.outputJson);
  if (!parsed.output) throw new AppError("This stage has no output to edit.", "VALIDATION", 409);
  const changed: Array<{ fieldPath: string; beforeText: string; afterText: string }> = [];

  let next = parsed.output;
  if (args.stage === "RESEARCH") next = editResearch(parsed.output as ResearchOutput, args.content, changed);
  else if (args.stage === "OUTLINE") next = editOutline(parsed.output as OutlineOutput, args.content, changed);
  else if (args.stage === "DRAFT") next = editDraft(parsed.output as DraftOutput, args.content, changed);
  else if (args.stage === "REPURPOSE") next = editRepurpose(parsed.output as RepurposeOutput, args.content, changed);
  else throw new AppError("Editorial findings stay as the checker wrote them. Approve them, reject them, or regenerate the draft.", "VALIDATION", 400);

  if (changed.length === 0 && !args.nextStatus) return { changed: [] };
  const claimed = await tx.stageExecution.updateMany({
    where: { id: args.executionId, revision: args.expectedRevision, status: args.fromStatus },
    data: {
      ...(changed.length > 0
        ? { outputJson: withMeta(next, { humanEdited: true, editedFields: unique([...(parsed.meta.editedFields ?? []), ...changed.map((edit) => edit.fieldPath)]) }) }
        : {}),
      ...(args.nextStatus ? { status: args.nextStatus } : {}),
      revision: { increment: 1 },
    },
  });
  if (claimed.count !== 1) throw new LostRaceError();
  if (changed.length === 0) return { changed: [] };
  await tx.humanEdit.createMany({
    data: changed.map((edit) => ({
      stageExecutionId: args.executionId,
      fieldPath: edit.fieldPath,
      beforeText: edit.beforeText.slice(0, 8000),
      afterText: edit.afterText.slice(0, 8000),
    })),
  });
  if (args.stage === "RESEARCH") await replaceClaims(tx, args.executionId, next as ResearchOutput);
  if (args.stage === "DRAFT") await replaceAssets(tx, args.runId, args.executionId, args.stage, next as DraftOutput);
  if (args.stage === "REPURPOSE") await replaceAssets(tx, args.runId, args.executionId, args.stage, next as RepurposeOutput);
  return { changed: changed.map((edit) => edit.fieldPath) };
}

function editResearch(output: ResearchOutput, content: unknown, changed: Change[]): ResearchOutput {
  const edit = researchEditSchema.parse(content);
  const expected = new Set(output.claims.map((claim) => claim.id));
  const incoming = new Set(edit.claims.map((claim) => claim.id));
  if (expected.size !== incoming.size || [...expected].some((id) => !incoming.has(id))) {
    throw new AppError("The edit does not match the claims on this research version.", "VALIDATION", 400);
  }
  note(changed, "summary", output.summary, edit.summary);
  const claims = output.claims.map((claim) => {
    const next = edit.claims.find((item) => item.id === claim.id)!;
    if (next.text === claim.text) return claim;
    note(changed, `claims.${claim.id}`, claim.text, next.text);
    return { ...claim, text: next.text, verification: "UNVERIFIED" as const, provenance: "HUMAN_EDITED" as const };
  });
  return { ...output, summary: edit.summary, claims };
}

function editOutline(output: OutlineOutput, content: unknown, changed: Change[]): OutlineOutput {
  const edit = outlineEditSchema.parse(content);
  const expected = output.sections.map((section) => section.id).join("|");
  const incoming = edit.sections.map((section) => section.id).join("|");
  if (expected !== incoming) throw new AppError("The edit does not match the sections on this outline version.", "VALIDATION", 400);
  note(changed, "workingTitle", output.workingTitle, edit.workingTitle);
  note(changed, "thesis", output.thesis, edit.thesis);
  note(changed, "audience", output.audience, edit.audience);
  const sections = output.sections.map((section) => {
    const next = edit.sections.find((item) => item.id === section.id)!;
    note(changed, `sections.${section.id}.heading`, section.heading, next.heading);
    note(changed, `sections.${section.id}.purpose`, section.purpose, next.purpose);
    note(changed, `sections.${section.id}.keyPoints`, section.keyPoints.join("\n"), next.keyPoints.join("\n"));
    return { ...section, heading: next.heading, purpose: next.purpose, keyPoints: next.keyPoints, wordAllocation: next.wordAllocation };
  });
  return { ...output, workingTitle: edit.workingTitle, thesis: edit.thesis, audience: edit.audience, sections };
}

function editDraft(output: DraftOutput, content: unknown, changed: Change[]): DraftOutput {
  const edit = draftEditSchema.parse(content);
  note(changed, "title", output.title, edit.title);
  note(changed, "cta", output.cta ?? "", edit.cta ?? "");
  note(changed, "seo.title", output.seo.title, edit.seo.title);
  note(changed, "seo.description", output.seo.description, edit.seo.description);
  note(changed, "seo.slug", output.seo.slug, edit.seo.slug);
  note(changed, "seo.keywords", output.seo.keywords.join(", "), edit.seo.keywords.join(", "));
  const before = blocksToMarkdownSafe(output);
  if (before !== edit.article.trim()) note(changed, "article", before, edit.article.trim());
  const blocks = before === edit.article.trim() ? output.blocks : markdownToBlocks(edit.article);
  if (blocks.length < 4) throw new AppError("The article needs at least a few paragraphs.", "VALIDATION", 400);
  return { ...output, title: edit.title, cta: edit.cta ?? "", seo: edit.seo, blocks };
}

function editRepurpose(output: RepurposeOutput, content: unknown, changed: Change[]): RepurposeOutput {
  const edit = repurposeEditSchema.parse(content);
  const keys = ["linkedin", "linkedinShort", "x", "newsletterIntro", "summary"] as const;
  const next = { ...output };
  for (const key of keys) {
    note(changed, key, output[key].body, edit[key]);
    next[key] = { ...output[key], body: edit[key], provenance: edit[key] === output[key].body ? output[key].provenance : "HUMAN_EDITED" };
  }
  return next;
}

async function replaceClaims(tx: Prisma.TransactionClient, executionId: string, output: ResearchOutput) {
  await tx.claim.deleteMany({ where: { stageExecutionId: executionId } });
  await tx.claim.createMany({
    data: output.claims.map((claim) => ({
      stageExecutionId: executionId,
      claimKey: claim.id,
      text: claim.text,
      sourceUrl: claim.sourceUrl,
      verification: claim.verification,
      provenance: claim.provenance,
    })),
  });
}

async function replaceAssets(tx: Prisma.TransactionClient, runId: string, executionId: string, stage: StageName, output: DraftOutput | RepurposeOutput) {
  const execution = await tx.stageExecution.findUnique({ where: { id: executionId } });
  if (!execution) return;
  await tx.generatedAsset.deleteMany({ where: { stageExecutionId: executionId } });
  await tx.generatedAsset.createMany({ data: assetsFor(runId, executionId, execution.version, stage, output) });
}

function assetsFor(runId: string, executionId: string, version: number, stage: StageName, output: DraftOutput | RepurposeOutput) {
  if (stage === "DRAFT") {
    const draft = output as DraftOutput;
    return [
      asset(runId, executionId, version, "article", blocksToMarkdownSafe(draft), "HUMAN_EDITED"),
      asset(runId, executionId, version, "seo", JSON.stringify(draft.seo), "HUMAN_EDITED"),
    ];
  }
  const pack = output as RepurposeOutput;
  return (["linkedin", "linkedinShort", "x", "newsletterIntro", "summary"] as const).map((kind) =>
    asset(runId, executionId, version, kind, pack[kind].body, pack[kind].provenance),
  );
}

function asset(runId: string, stageExecutionId: string, version: number, kind: string, content: string, provenance: string) {
  return { runId, stageExecutionId, version, kind, content, provenance, isCurrent: true, stale: false };
}

function blocksToMarkdownSafe(draft: DraftOutput): string {
  return draft.blocks.map((block) => (block.kind === "heading" ? `## ${block.text}` : block.text)).join("\n\n");
}

type Change = { fieldPath: string; beforeText: string; afterText: string };

function note(changed: Change[], fieldPath: string, beforeText: string, afterText: string) {
  if (beforeText !== afterText) changed.push({ fieldPath, beforeText, afterText });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
