import type { BrandProfile, Checkpoint, Claim, HumanEdit, Project, Source, StageExecution, WorkflowEvent, WorkflowRun } from "@prisma/client";
import type { RunView, StageOutput, StageStatus, StageView } from "@/domain/dto";
import {
  draftOutputSchema,
  editorialOutputSchema,
  outlineOutputSchema,
  repurposePackageSchema,
  researchOutputSchema,
} from "@/domain/schemas";
import { STAGE_META, STAGE_ORDER, type StageName } from "@/domain/stages";
import { blocksToMarkdown } from "@/domain/text";
import { faultSimulationEnabled, liveAiConfigured, liveSearchConfigured } from "@/server/auth";
import type { Brief } from "@prisma/client";

type StageRow = StageExecution & {
  sources: Source[];
  claims: Claim[];
  edits: HumanEdit[];
  checkpoints: Checkpoint[];
};

type RunRow = WorkflowRun & {
  project: Project & { brand: BrandProfile | null };
  brief: Brief;
  stages: StageRow[];
  events: WorkflowEvent[];
};

export function toRunView(run: RunRow): RunView {
  const current = new Map<StageName, StageRow>();
  for (const stage of run.stages) {
    if (stage.isCurrent) current.set(stage.stage as StageName, stage);
  }
  const currentVersions = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, current.get(stage)?.version ?? null])) as Record<StageName, number | null>;

  const stages: StageView[] = STAGE_ORDER.map((stage) => {
    const row = current.get(stage) ?? null;
    return row ? toStageView(row, currentVersions) : emptyStage(stage);
  });

  const edits = run.stages
    .flatMap((stage) =>
      stage.edits.map((edit) => ({
        id: edit.id,
        stage: stage.stage as StageName,
        version: stage.version,
        fieldPath: edit.fieldPath,
        beforeText: edit.beforeText,
        afterText: edit.afterText,
        createdAt: edit.createdAt.toISOString(),
      })),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    id: run.id,
    state: run.state as RunView["state"],
    mode: run.mode === "live" ? "live" : "mock",
    activeStage: (run.activeStage as StageName | null) ?? null,
    lastError: run.lastError,
    errorRetryable: run.errorRetryable,
    failedStage: (run.failedStage as StageName | null) ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    project: { id: run.project.id, name: run.project.name },
    brief: {
      id: run.brief.id,
      title: run.brief.title,
      rawBrief: run.brief.rawBrief,
      audience: run.brief.audience,
      contentGoal: run.brief.contentGoal,
      category: run.brief.category,
    },
    brand: run.project.brand
      ? {
          brandName: run.project.brand.brandName,
          tone: run.project.brand.tone,
          audience: run.project.brand.audience,
          preferredLanguage: run.project.brand.preferredLanguage,
          wordsToUse: parseStringArray(run.project.brand.wordsToUseJson),
          wordsToAvoid: parseStringArray(run.project.brand.wordsToAvoidJson),
          styleGuidance: run.project.brand.styleGuidance,
          exampleCopy: run.project.brand.exampleCopy,
        }
      : null,
    stages,
    events: [...run.events].reverse().map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    })),
    edits,
    capabilities: {
      faultSimulation: faultSimulationEnabled(),
      liveAi: liveAiConfigured(),
      liveSearch: liveSearchConfigured(),
    },
  };
}

function toStageView(row: StageRow, currentVersions: Record<StageName, number | null>): StageView {
  const stage = row.stage as StageName;
  const parsed = parseStored(stage, row.outputJson);
  const staleReason = staleReasonFor(row, currentVersions);
  const openCheckpoint = row.checkpoints.find((checkpoint) => checkpoint.status === "OPEN") ?? row.checkpoints[0] ?? null;
  const keepStatus = row.status === "RUNNING" || row.status === "FAILED" || row.status === "REJECTED" || row.status === "CANCELLED";
  return {
    stage,
    label: STAGE_META[stage].label,
    purpose: STAGE_META[stage].purpose,
    status: (!keepStatus && staleReason ? "STALE" : row.status) as StageStatus,
    version: row.version,
    revision: row.revision,
    attemptCount: row.attemptCount,
    maxRetries: row.maxRetries,
    manualRetries: row.manualRetries,
    lastError: row.lastError,
    errorRetryable: row.errorRetryable,
    stale: Boolean(staleReason),
    staleReason,
    inputVersions: parseInput(row.inputVersionJson),
    durationMs: row.durationMs,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    humanEdited: parsed.meta.humanEdited,
    editedFields: parsed.meta.editedFields,
    editCount: row.edits.length,
    checkpoint: openCheckpoint
      ? { id: openCheckpoint.id, status: openCheckpoint.status, reason: openCheckpoint.reason }
      : null,
    output: parsed.output,
    article: stage === "DRAFT" && parsed.output && "blocks" in parsed.output ? blocksToMarkdown(parsed.output.blocks) : null,
    sources: row.sources.map((source) => ({
      id: source.sourceKey,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      retrievedAt: source.retrievedAt.toISOString(),
      excerpt: source.excerpt,
      relevance: source.relevance,
      provider: source.provider === "tavily" ? "tavily" : "demo-corpus",
    })),
    claims: row.claims.map((claim) => ({
      id: claim.claimKey,
      text: claim.text,
      sourceUrl: claim.sourceUrl,
      verification: claim.verification as StageView["claims"][number]["verification"],
      provenance: claim.provenance as StageView["claims"][number]["provenance"],
    })),
  };
}

function emptyStage(stage: StageName): StageView {
  return {
    stage,
    label: STAGE_META[stage].label,
    purpose: STAGE_META[stage].purpose,
    status: "WAITING",
    version: null,
    revision: null,
    attemptCount: 0,
    maxRetries: 3,
    manualRetries: 0,
    lastError: null,
    errorRetryable: false,
    stale: false,
    staleReason: null,
    inputVersions: {},
    durationMs: null,
    startedAt: null,
    completedAt: null,
    humanEdited: false,
    editedFields: [],
    editCount: 0,
    checkpoint: null,
    output: null,
    article: null,
    sources: [],
    claims: [],
  };
}

export function parseStored(stage: StageName, raw: string | null): {
  output: StageOutput | null;
  meta: { humanEdited: boolean; editedFields: string[] };
} {
  const meta = { humanEdited: false, editedFields: [] as string[] };
  if (!raw) return { output: null, meta };
  try {
    const value = JSON.parse(raw) as { meta?: { humanEdited?: boolean; editedFields?: string[] } };
    if (value.meta) {
      meta.humanEdited = Boolean(value.meta.humanEdited);
      meta.editedFields = Array.isArray(value.meta.editedFields) ? value.meta.editedFields : [];
    }
    const { meta: _meta, ...rest } = value;
    void _meta;
    const schema = schemaFor(stage);
    const parsed = schema.safeParse(rest);
    return { output: parsed.success ? parsed.data : null, meta };
  } catch {
    return { output: null, meta };
  }
}

function schemaFor(stage: StageName) {
  switch (stage) {
    case "RESEARCH":
      return researchOutputSchema;
    case "OUTLINE":
      return outlineOutputSchema;
    case "DRAFT":
      return draftOutputSchema;
    case "EDITORIAL":
      return editorialOutputSchema;
    case "REPURPOSE":
      return repurposePackageSchema;
  }
}

export function staleReasonFor(row: StageExecution, currentVersions: Record<StageName, number | null>): string | null {
  const input = parseInput(row.inputVersionJson);
  for (const stage of STAGE_ORDER) {
    const used = input[stage];
    if (used == null) continue;
    const latest = currentVersions[stage];
    if (latest != null && latest !== used) {
      return `Based on ${STAGE_META[stage].label} v${used}. Current ${STAGE_META[stage].label} is v${latest}.`;
    }
  }
  if (row.status === "STALE") return row.staleReason ?? "This stage depends on an older upstream version.";
  return null;
}

function parseInput(raw: string): Partial<Record<StageName, number>> {
  try {
    const value = JSON.parse(raw) as Partial<Record<StageName, number>>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function withMeta(output: unknown, meta = { humanEdited: false, editedFields: [] as string[] }): string {
  return JSON.stringify({ ...(output as object), meta });
}
