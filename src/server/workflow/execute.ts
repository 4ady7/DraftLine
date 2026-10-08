import { createHash, randomUUID } from "crypto";
import type { Prisma, StageExecution, WorkflowRun } from "@prisma/client";
import type { StageName } from "@/domain/stages";
import {
  CHECKPOINT_STAGES,
  STAGE_META,
  assertTransition,
  downstreamStages,
  isRunningState,
  reviewStateFor,
  runningStateFor,
  type RunState,
} from "@/domain/stages";
import type { DraftOutput, EditorialOutput, OutlineOutput, RepurposeOutput, ResearchOutput } from "@/domain/schemas";
import { consumeFault, retryDelay, sleep, stageDelay } from "@/server/ai/provider";
import { runAgent, type Upstream } from "@/server/agents/run-stage";
import { getDb } from "@/server/db";
import { emitEvent } from "@/server/events";
import { failureOf, LostRaceError } from "@/server/errors";
import { parseStored, withMeta } from "@/server/workflow/dto";

const inflight = new Map<string, Promise<void>>();

export function isInflight(runId: string): boolean {
  return inflight.has(runId);
}

export function enqueue(runId: string): Promise<void> {
  const existing = inflight.get(runId);
  if (existing) return existing;
  let release: () => void = () => undefined;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  inflight.set(runId, blocker);
  void executeActiveStage(runId)
    .catch((error) => {
      console.error("workflow execution failed", error instanceof Error ? error.name : "error");
    })
    .finally(() => {
      if (inflight.get(runId) === blocker) inflight.delete(runId);
      release();
    });
  return blocker;
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function newLock(): string {
  return randomUUID();
}

async function executeActiveStage(runId: string): Promise<void> {
  const initial = await getDb().workflowRun.findUnique({ where: { id: runId } });
  if (!initial || !isRunningState(initial.state as RunState) || !initial.activeStage || !initial.lockToken) return;
  const stage = initial.activeStage as StageName;
  const execution = await getDb().stageExecution.findFirst({
    where: { runId, stage, isCurrent: true, status: "RUNNING" },
  });
  if (!execution) return;

  for (;;) {
    const run = await getDb().workflowRun.findUnique({ where: { id: runId } });
    if (!run || run.state === "CANCELLED" || run.lockToken !== initial.lockToken) return;
    if (run.state !== runningStateFor(stage)) return;
    const current = await getDb().stageExecution.findUnique({ where: { id: execution.id } });
    if (!current || current.status !== "RUNNING") return;

    const attempt = current.attemptCount + 1;
    await getDb().stageExecution.update({ where: { id: current.id }, data: { attemptCount: attempt } });
    const label = STAGE_META[stage].label;
    await emitEvent(
      runId,
      attempt === 1 ? "stage_started" : "retry_started",
      attempt === 1 ? `${label} started` : `${label} is retrying. Attempt ${attempt} of ${current.maxRetries}.`,
    );

    const started = Date.now();
    try {
      await sleep(stageDelay());
      const gate = await getDb().workflowRun.findUnique({ where: { id: runId } });
      if (!gate || gate.state === "CANCELLED" || gate.lockToken !== initial.lockToken || gate.state !== runningStateFor(stage)) return;
      const upstream = await loadUpstream(runId, current);
      const output = await runAgent({
        runId,
        projectId: run.projectId,
        stageExecutionId: current.id,
        stage,
        mode: run.mode === "live" ? "live" : "mock",
        brief: await loadBrief(run.briefId),
        upstream,
      });
      await consumeFault(runId, stage, "database_failure");
      await persistSuccess({ runId, lockToken: initial.lockToken, stage, execution: current, output, started });
      return;
    } catch (error) {
      if (error instanceof LostRaceError) return;
      const failure = failureOf(error);
      await getDb().stageExecution.update({
        where: { id: current.id },
        data: { lastError: failure.message, errorRetryable: failure.retryable },
      });
      if (failure.retryable && attempt < current.maxRetries) {
        await transitionLocked(runId, initial.lockToken, "RETRYING", { activeStage: stage });
        await emitEvent(runId, "retry_started", `${label} failed because ${lowerFirst(failure.message)} Attempt ${attempt} of ${current.maxRetries}.`);
        await sleep(retryDelay());
        await transitionLocked(runId, initial.lockToken, runningStateFor(stage), { activeStage: stage });
        continue;
      }
      await persistFailure({ runId, lockToken: initial.lockToken, stage, executionId: current.id, message: failure.message, retryable: failure.retryable, started });
      return;
    }
  }
}

async function persistSuccess(args: {
  runId: string;
  lockToken: string;
  stage: StageName;
  execution: StageExecution;
  output: ResearchOutput | OutlineOutput | DraftOutput | EditorialOutput | RepurposeOutput;
  started: number;
}) {
  const db = getDb();
  const checkpoint = CHECKPOINT_STAGES.has(args.stage);
  const nextState: RunState = checkpoint ? reviewStateFor(args.stage)! : "COMPLETED";
  const durationMs = Date.now() - args.started;
  await db.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({ where: { id: args.runId } });
    if (!run || run.lockToken !== args.lockToken || run.state !== runningStateFor(args.stage)) throw new LostRaceError();
    const stageWrite = await tx.stageExecution.updateMany({
      where: { id: args.execution.id, status: "RUNNING" },
      data: {
        status: checkpoint ? "AWAITING_REVIEW" : "COMPLETED",
        outputJson: withMeta(args.output),
        completedAt: new Date(),
        durationMs,
        lastError: null,
        errorRetryable: false,
      },
    });
    if (stageWrite.count !== 1) throw new LostRaceError();
    await projectOutput(tx, args.runId, args.execution, args.stage, args.output);
    if (checkpoint) {
      await tx.checkpoint.create({
        data: { runId: args.runId, stageExecutionId: args.execution.id, stage: args.stage, status: "OPEN" },
      });
    }
    await changeState(tx, run, nextState, {
      activeStage: args.stage,
      lockToken: null,
      lockedAt: null,
      lastError: null,
      failedStage: null,
      errorRetryable: false,
      completedAt: nextState === "COMPLETED" ? new Date() : null,
    });
    await tx.workflowEvent.create({
      data: {
        runId: args.runId,
        type: checkpoint ? "checkpoint_created" : "stage_completed",
        message: checkpoint
          ? `${STAGE_META[args.stage].label} is ready for review.`
          : `${STAGE_META[args.stage].label} completed.`,
      },
    });
  });
}

async function persistFailure(args: {
  runId: string;
  lockToken: string;
  stage: StageName;
  executionId: string;
  message: string;
  retryable: boolean;
  started: number;
}) {
  const db = getDb();
  await db.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({ where: { id: args.runId } });
    if (!run || run.lockToken !== args.lockToken) throw new LostRaceError();
    const stageWrite = await tx.stageExecution.updateMany({
      where: { id: args.executionId, status: "RUNNING" },
      data: {
        status: "FAILED",
        lastError: args.message,
        errorRetryable: args.retryable,
        completedAt: new Date(),
        durationMs: Date.now() - args.started,
      },
    });
    if (stageWrite.count !== 1) throw new LostRaceError();
    await changeState(tx, run, "FAILED", {
      activeStage: args.stage,
      failedStage: args.stage,
      lastError: args.message,
      errorRetryable: args.retryable,
      lockToken: null,
      lockedAt: null,
    });
    await tx.workflowEvent.create({
      data: {
        runId: args.runId,
        type: "stage_failed",
        message: `${STAGE_META[args.stage].label} failed because ${lowerFirst(args.message)}`,
      },
    });
  });
}

async function transitionLocked(runId: string, lockToken: string, to: RunState, data: Prisma.WorkflowRunUpdateManyMutationInput) {
  const db = getDb();
  await db.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({ where: { id: runId } });
    if (!run || run.lockToken !== lockToken) throw new LostRaceError();
    await changeState(tx, run, to, data);
  });
}

export async function changeState(
  tx: Prisma.TransactionClient,
  run: WorkflowRun,
  to: RunState,
  data: Prisma.WorkflowRunUpdateManyMutationInput,
) {
  assertTransition(run.state as RunState, to, { activeStage: (run.activeStage as StageName | null) ?? null });
  const updated = await tx.workflowRun.updateMany({
    where: { id: run.id, state: run.state, lockToken: run.lockToken },
    data: { state: to, ...data },
  });
  if (updated.count !== 1) throw new LostRaceError();
}

export async function openStage(
  tx: Prisma.TransactionClient,
  runId: string,
  stage: StageName,
  inputVersion: Partial<Record<StageName, number>>,
) {
  const max = await tx.stageExecution.aggregate({ where: { runId, stage }, _max: { version: true } });
  const version = (max._max.version ?? 0) + 1;
  const reason = `${STAGE_META[stage].label} v${version} replaced the version later stages were built from.`;
  const down = downstreamStages(stage);
  if (down.length > 0) {
    const targets = await tx.stageExecution.findMany({ where: { runId, stage: { in: down }, isCurrent: true } });
    const ids = targets.map((target) => target.id);
    if (ids.length > 0) {
      await tx.stageExecution.updateMany({ where: { id: { in: ids } }, data: { status: "STALE", staleReason: reason } });
      await tx.generatedAsset.updateMany({ where: { stageExecutionId: { in: ids } }, data: { stale: true } });
      await tx.checkpoint.updateMany({ where: { runId, stage: { in: down }, status: "OPEN" }, data: { status: "SUPERSEDED" } });
      await tx.workflowEvent.create({
        data: { runId, type: "stale_marked", message: reason },
      });
    }
  }
  const previous = await tx.stageExecution.findMany({ where: { runId, stage, isCurrent: true } });
  if (previous.length > 0) {
    await tx.generatedAsset.updateMany({
      where: { stageExecutionId: { in: previous.map((item) => item.id) } },
      data: { isCurrent: false },
    });
    await tx.stageExecution.updateMany({ where: { runId, stage, isCurrent: true }, data: { isCurrent: false } });
  }
  await tx.checkpoint.updateMany({ where: { runId, stage, status: "OPEN" }, data: { status: "SUPERSEDED" } });
  return tx.stageExecution.create({
    data: {
      runId,
      stage,
      version,
      status: "RUNNING",
      inputVersionJson: JSON.stringify(inputVersion),
      isCurrent: true,
      startedAt: new Date(),
      maxRetries: 3,
    },
  });
}

async function projectOutput(
  tx: Prisma.TransactionClient,
  runId: string,
  execution: StageExecution,
  stage: StageName,
  output: ResearchOutput | OutlineOutput | DraftOutput | EditorialOutput | RepurposeOutput,
) {
  if (stage === "RESEARCH") {
    const research = output as ResearchOutput;
    await tx.source.createMany({
      data: research.sources.map((source) => ({
        stageExecutionId: execution.id,
        sourceKey: source.id,
        url: source.url,
        title: source.title,
        publisher: source.publisher,
        retrievedAt: new Date(source.retrievedAt),
        excerpt: source.excerpt,
        relevance: source.relevance,
        provider: source.provider,
      })),
    });
    await tx.claim.createMany({
      data: research.claims.map((claim) => ({
        stageExecutionId: execution.id,
        claimKey: claim.id,
        text: claim.text,
        sourceUrl: claim.sourceUrl,
        verification: claim.verification,
        provenance: claim.provenance,
      })),
    });
  }
  const assets = assetRows(runId, execution, stage, output);
  if (assets.length > 0) await tx.generatedAsset.createMany({ data: assets });
}

function assetRows(
  runId: string,
  execution: StageExecution,
  stage: StageName,
  output: ResearchOutput | OutlineOutput | DraftOutput | EditorialOutput | RepurposeOutput,
) {
  const base = { runId, stageExecutionId: execution.id, version: execution.version, isCurrent: true, stale: false };
  if (stage === "DRAFT") {
    const draft = output as DraftOutput;
    return [
      { ...base, kind: "article", content: draft.blocks.map((block) => (block.kind === "heading" ? `## ${block.text}` : block.text)).join("\n\n"), provenance: "MODEL_GENERATED" },
      { ...base, kind: "seo", content: JSON.stringify(draft.seo), provenance: "MODEL_GENERATED" },
    ];
  }
  if (stage === "REPURPOSE") {
    const pack = output as RepurposeOutput;
    return (["linkedin", "linkedinShort", "x", "newsletterIntro", "summary"] as const).map((kind) => ({
      ...base,
      kind,
      content: pack[kind].body,
      provenance: pack[kind].provenance,
    }));
  }
  return [];
}

async function loadUpstream(runId: string, execution: StageExecution): Promise<Upstream> {
  const input = JSON.parse(execution.inputVersionJson) as Partial<Record<StageName, number>>;
  const upstream: Upstream = {};
  for (const stage of ["RESEARCH", "OUTLINE", "DRAFT", "EDITORIAL"] as const) {
    const version = input[stage];
    if (version == null) continue;
    const row = await getDb().stageExecution.findUnique({ where: { runId_stage_version: { runId, stage, version } } });
    const parsed = parseStored(stage, row?.outputJson ?? null).output;
    if (!row || !parsed || (row.status !== "APPROVED" && row.status !== "COMPLETED")) {
      throw new LostRaceError();
    }
    if (stage === "RESEARCH") upstream.research = parsed as ResearchOutput;
    if (stage === "OUTLINE") upstream.outline = parsed as OutlineOutput;
    if (stage === "DRAFT") upstream.draft = parsed as DraftOutput;
    if (stage === "EDITORIAL") upstream.editorial = parsed as EditorialOutput;
  }
  return upstream;
}

async function loadBrief(briefId: string) {
  const brief = await getDb().brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new LostRaceError();
  return {
    title: brief.title,
    rawBrief: brief.rawBrief,
    audience: brief.audience,
    contentGoal: brief.contentGoal,
    category: brief.category,
  };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
