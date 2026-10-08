import { Prisma, type StageExecution, type WorkflowRun } from "@prisma/client";
import type { RunView } from "@/domain/dto";
import type { StageName } from "@/domain/stages";
import {
  STAGE_META,
  STAGE_ORDER,
  isRunningState,
  isStageName,
  reviewStateFor,
  runningStateFor,
  type RunState,
} from "@/domain/stages";
import type { BrandProfileInput } from "@/domain/schemas";
import { demoPackage } from "@/server/demo/catalog";
import { liveAiConfigured } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, LostRaceError } from "@/server/errors";
import { applyEdit } from "@/server/workflow/edits";
import { staleReasonFor, toRunView } from "@/server/workflow/dto";
import { changeState, enqueue, hashPayload, isInflight, newLock, openStage } from "@/server/workflow/execute";

type CreateInput = {
  kind: "demo";
  demoId: "northwind-close" | "hale-retainer" | "relay-agents";
  mode: "mock" | "live";
} | {
  kind: "custom";
  mode: "mock" | "live";
  projectName: string;
  title: string;
  rawBrief: string;
  audience: string;
  contentGoal: string;
  brand?: BrandProfileInput;
};

export async function createRun(owner: string, input: CreateInput, idempotencyKey: string): Promise<{ runId: string; replayed: boolean }> {
  assertMode(input.mode);
  const hash = hashPayload(input);
  const existing = await getDb().idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
  if (existing) return replay(existing, owner, hash);
  try {
    return await getDb().$transaction(async (tx) => {
      const material = materialize(input);
      const project = await tx.project.create({ data: { ownerKey: owner, name: material.projectName } });
      if (material.brand) {
        await tx.brandProfile.create({
          data: {
            projectId: project.id,
            brandName: material.brand.brandName,
            tone: material.brand.tone,
            audience: material.brand.audience,
            preferredLanguage: material.brand.preferredLanguage,
            wordsToUseJson: JSON.stringify(material.brand.wordsToUse),
            wordsToAvoidJson: JSON.stringify(material.brand.wordsToAvoid),
            styleGuidance: material.brand.styleGuidance,
            exampleCopy: material.brand.exampleCopy,
          },
        });
      }
      const brief = await tx.brief.create({
        data: {
          projectId: project.id,
          title: material.title,
          rawBrief: material.rawBrief,
          audience: material.audience,
          contentGoal: material.contentGoal,
          category: material.category,
        },
      });
      const run = await tx.workflowRun.create({
        data: {
          projectId: project.id,
          briefId: brief.id,
          ownerKey: owner,
          state: "DRAFT_CREATED",
          mode: input.mode,
        },
      });
      await tx.workflowEvent.create({
        data: { runId: run.id, type: "state_changed", message: "Brief saved. The workflow is waiting to start." },
      });
      await tx.idempotencyRecord.create({
        data: { key: idempotencyKey, ownerKey: owner, runId: run.id, action: "create", requestHash: hash },
      });
      return { runId: run.id, replayed: false };
    });
  } catch (error) {
    return recoverIdempotency(error, idempotencyKey, owner, hash);
  }
}

export async function getRun(owner: string, runId: string): Promise<RunView> {
  return toRunView(await loadRun(owner, runId));
}

export async function startRun(owner: string, runId: string, idempotencyKey: string, wait = false): Promise<{ replayed: boolean }> {
  const result = await mutate(owner, runId, idempotencyKey, "start", {}, async (tx, run) => {
    if (run.state !== "DRAFT_CREATED") throw new AppError("This run has already started.", "CONFLICT", 409);
    const lockToken = newLock();
    await changeState(tx, run, "RESEARCH_RUNNING", {
      activeStage: "RESEARCH",
      lockToken,
      lockedAt: new Date(),
      lastError: null,
      failedStage: null,
      errorRetryable: false,
    });
    await openStage(tx, run.id, "RESEARCH", {});
    await tx.workflowEvent.create({ data: { runId: run.id, type: "state_changed", message: "The brief was accepted and research was queued." } });
  });
  const pending = enqueue(runId);
  if (wait) await pending;
  return result;
}

export async function kick(owner: string, runId: string): Promise<void> {
  const run = await mustOwn(owner, runId);
  if (isInflight(runId)) return;
  if (run.state === "RETRYING" && run.activeStage && isStageName(run.activeStage)) {
    const to = runningStateFor(run.activeStage);
    await getDb().$transaction(async (tx) => {
      const fresh = await tx.workflowRun.findUnique({ where: { id: runId } });
      if (!fresh || fresh.state !== "RETRYING") return;
      await changeState(tx, fresh, to, { activeStage: run.activeStage, lockToken: fresh.lockToken ?? newLock(), lockedAt: new Date() });
    });
  }
  const fresh = await mustOwn(owner, runId);
  if (isRunningState(fresh.state as RunState) && !fresh.lockToken) {
    await getDb().workflowRun.updateMany({
      where: { id: runId, state: fresh.state, lockToken: null },
      data: { lockToken: newLock(), lockedAt: new Date() },
    });
  }
  const current = await mustOwn(owner, runId);
  if (isRunningState(current.state as RunState)) enqueue(runId);
}

export async function approve(
  owner: string,
  runId: string,
  idempotencyKey: string,
  body: { stage: StageName; expectedRevision: number },
  wait = false,
): Promise<{ replayed: boolean }> {
  const result = await mutate(owner, runId, idempotencyKey, "approve", body, async (tx, run) => {
    const execution = await currentStage(tx, run.id, body.stage);
    await assertReview(tx, run, execution, body.expectedRevision);
    await claimExecution(tx, execution, body.expectedRevision, ["AWAITING_REVIEW"], { status: "APPROVED" });
    await tx.checkpoint.updateMany({
      where: { stageExecutionId: execution.id, status: "OPEN" },
      data: { status: "APPROVED", decidedAt: new Date() },
    });
    const next = STAGE_ORDER[STAGE_ORDER.indexOf(body.stage) + 1];
    if (!next) throw new AppError("This stage has nowhere to advance.", "CONFLICT", 409);
    const rows = await tx.stageExecution.findMany({ where: { runId: run.id, isCurrent: true } });
    const approved = rows.map((row) => (row.id === execution.id ? { ...row, status: "APPROVED" } : row));
    const lockToken = newLock();
    await changeState(tx, run, runningStateFor(next), {
      activeStage: next,
      lockToken,
      lockedAt: new Date(),
      lastError: null,
      failedStage: null,
      errorRetryable: false,
    });
    await openStage(tx, run.id, next, inputVersions(next, approved));
    await tx.workflowEvent.create({
      data: { runId: run.id, type: "approved", message: `${STAGE_META[body.stage].label} approved. ${STAGE_META[next].label} started.` },
    });
  });
  const pending = enqueue(runId);
  if (wait) await pending;
  return result;
}

export async function reject(
  owner: string,
  runId: string,
  idempotencyKey: string,
  body: { stage: StageName; expectedRevision: number; reason: string },
): Promise<{ replayed: boolean }> {
  return mutate(owner, runId, idempotencyKey, "reject", body, async (tx, run) => {
    const execution = await currentStage(tx, run.id, body.stage);
    await assertReview(tx, run, execution, body.expectedRevision);
    await claimExecution(tx, execution, body.expectedRevision, ["AWAITING_REVIEW"], { status: "REJECTED" });
    await tx.checkpoint.updateMany({
      where: { stageExecutionId: execution.id, status: "OPEN" },
      data: { status: "REJECTED", reason: body.reason, decidedAt: new Date() },
    });
    await changeState(tx, run, "BLOCKED", { activeStage: body.stage, lockToken: null, lockedAt: null });
    await tx.workflowEvent.create({
      data: { runId: run.id, type: "rejected", message: `${STAGE_META[body.stage].label} rejected. ${body.reason}` },
    });
  });
}

export async function editStage(
  owner: string,
  runId: string,
  idempotencyKey: string,
  body: { stage: StageName; expectedRevision: number; content: unknown },
): Promise<{ replayed: boolean }> {
  return mutate(owner, runId, idempotencyKey, "edit", body, async (tx, run) => {
    const execution = await currentStage(tx, run.id, body.stage);
    if (execution.revision !== body.expectedRevision) {
      throw new AppError("This stage changed since you opened it. Reload before editing.", "STALE_VERSION", 409);
    }
    assertEditable(run, execution);
    const reopening = run.state === "BLOCKED" && execution.status === "REJECTED";
    if (body.stage === "EDITORIAL" && !reopening) {
      throw new AppError("Editorial findings stay as the checker wrote them. Approve them, reject them, or regenerate the draft.", "VALIDATION", 400);
    }
    const fromStatus = reopening ? "REJECTED" : execution.status;
    const nextStatus = reopening ? "AWAITING_REVIEW" : undefined;
    const { changed } = body.stage === "EDITORIAL"
      ? { changed: [] as string[] }
      : await applyEdit(tx, {
          runId: run.id,
          stage: body.stage,
          executionId: execution.id,
          outputJson: execution.outputJson,
          content: body.content,
          expectedRevision: body.expectedRevision,
          fromStatus,
          nextStatus,
        });
    if (body.stage === "EDITORIAL" && reopening) {
      await claimExecution(tx, execution, body.expectedRevision, ["REJECTED"], { status: "AWAITING_REVIEW" });
    }
    if (reopening) {
      await tx.checkpoint.create({
        data: { runId: run.id, stageExecutionId: execution.id, stage: body.stage, status: "OPEN" },
      });
      await changeState(tx, run, reviewStateFor(body.stage)!, { activeStage: body.stage, lockToken: null, lockedAt: null });
    }
    if (changed.length > 0) {
      await tx.workflowEvent.create({
        data: { runId: run.id, type: "human_edit", message: `${STAGE_META[body.stage].label} was edited by a person.` },
      });
    } else if (reopening) {
      await tx.workflowEvent.create({
        data: { runId: run.id, type: "state_changed", message: `${STAGE_META[body.stage].label} is back in review.` },
      });
    }
  });
}

export async function regenerate(
  owner: string,
  runId: string,
  idempotencyKey: string,
  stage: StageName,
  wait = false,
): Promise<{ replayed: boolean }> {
  const result = await mutate(owner, runId, idempotencyKey, "regenerate", { stage }, async (tx, run) => {
    if (isRunningState(run.state as RunState) || run.state === "RETRYING" || run.state === "CANCELLED" || run.state === "DRAFT_CREATED") {
      throw new AppError("Wait until the current stage stops before regenerating.", "CONFLICT", 409);
    }
    const existing = await tx.stageExecution.findFirst({ where: { runId: run.id, stage, isCurrent: true } });
    if (!existing) throw new AppError(`${STAGE_META[stage].label} has not run yet.`, "CONFLICT", 409);
    const rows = await tx.stageExecution.findMany({ where: { runId: run.id, isCurrent: true } });
    const lockToken = newLock();
    await changeState(tx, run, runningStateFor(stage), {
      activeStage: stage,
      failedStage: null,
      lastError: null,
      errorRetryable: false,
      lockToken,
      lockedAt: new Date(),
      completedAt: null,
    });
    await openStage(tx, run.id, stage, inputVersions(stage, rows));
    await tx.workflowEvent.create({
      data: { runId: run.id, type: "state_changed", message: `${STAGE_META[stage].label} is running again. Later stages are stale.` },
    });
  });
  const pending = enqueue(runId);
  if (wait) await pending;
  return result;
}

export async function retry(owner: string, runId: string, idempotencyKey: string, wait = false): Promise<{ replayed: boolean }> {
  const result = await mutate(owner, runId, idempotencyKey, "retry", {}, async (tx, run) => {
    if (run.state !== "FAILED" || !run.failedStage || !isStageName(run.failedStage)) {
      throw new AppError("There is no failed stage to retry.", "CONFLICT", 409);
    }
    const stage = run.failedStage;
    const execution = await currentStage(tx, run.id, stage);
    if (execution.status !== "FAILED") throw new AppError("The current stage is not failed.", "CONFLICT", 409);
    if (execution.manualRetries >= 10) {
      throw new AppError("This stage has been retried enough times. Regenerate it or start a new run.", "RETRY_EXHAUSTED", 409);
    }
    const lockToken = newLock();
    await changeState(tx, run, "RETRYING", { activeStage: stage, lockToken, lockedAt: new Date() });
    const mid = { ...run, state: "RETRYING", activeStage: stage, lockToken };
    await changeState(tx, mid, runningStateFor(stage), {
      activeStage: stage,
      lockToken,
      lockedAt: new Date(),
      failedStage: null,
      lastError: null,
      errorRetryable: false,
    });
    await tx.stageExecution.update({
      where: { id: execution.id },
      data: {
        status: "RUNNING",
        attemptCount: 0,
        manualRetries: { increment: 1 },
        lastError: null,
        errorRetryable: false,
        startedAt: new Date(),
        completedAt: null,
      },
    });
    await tx.workflowRun.update({ where: { id: run.id }, data: { manualRetryCount: { increment: 1 } } });
    await tx.workflowEvent.create({
      data: { runId: run.id, type: "retry_started", message: `${STAGE_META[stage].label} retry requested.` },
    });
  });
  const pending = enqueue(runId);
  if (wait) await pending;
  return result;
}

export async function cancel(owner: string, runId: string, idempotencyKey: string): Promise<{ replayed: boolean }> {
  return mutate(owner, runId, idempotencyKey, "cancel", {}, async (tx, run) => {
    if (run.state === "COMPLETED" || run.state === "CANCELLED") {
      throw new AppError("This run is already finished.", "CONFLICT", 409);
    }
    await tx.stageExecution.updateMany({
      where: { runId: run.id, status: "RUNNING" },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    await tx.checkpoint.updateMany({ where: { runId: run.id, status: "OPEN" }, data: { status: "SUPERSEDED" } });
    await changeState(tx, run, "CANCELLED", { lockToken: null, lockedAt: null, activeStage: run.activeStage });
    await tx.workflowEvent.create({ data: { runId: run.id, type: "state_changed", message: "Run cancelled." } });
  });
}

export async function simulate(
  owner: string,
  runId: string,
  idempotencyKey: string,
  body: { stage: StageName; fault: "ai_timeout" | "search_timeout" | "malformed_output" | "database_failure"; times: number },
): Promise<{ replayed: boolean }> {
  if (process.env.NODE_ENV === "production" && process.env.DRAFTLINE_FAULTS !== "1") {
    throw new AppError("Failure simulation is not available in this environment.", "NOT_FOUND", 404);
  }
  return mutate(owner, runId, idempotencyKey, "simulate", body, async (tx, run) => {
    if (run.state === "CANCELLED" || run.state === "COMPLETED") {
      throw new AppError("This run is not accepting a simulated failure.", "CONFLICT", 409);
    }
    await tx.workflowRun.update({
      where: { id: run.id },
      data: { faultJson: JSON.stringify({ stage: body.stage, type: body.fault, remaining: body.times }) },
    });
    await tx.workflowEvent.create({
      data: { runId: run.id, type: "state_changed", message: `Failure simulation armed for ${STAGE_META[body.stage].label}.` },
    });
  });
}

async function mutate(
  owner: string,
  runId: string,
  idempotencyKey: string,
  action: string,
  body: unknown,
  fn: (tx: Prisma.TransactionClient, run: WorkflowRun) => Promise<void>,
): Promise<{ replayed: boolean }> {
  await mustOwn(owner, runId);
  const hash = hashPayload({ action, body });
  const existing = await getDb().idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
  if (existing) return replay(existing, owner, hash);
  try {
    return await getDb().$transaction(async (tx) => {
      const run = await tx.workflowRun.findFirst({ where: { id: runId, ownerKey: owner } });
      if (!run) throw new AppError("Run not found.", "NOT_FOUND", 404);
      await fn(tx, run);
      await tx.idempotencyRecord.create({
        data: { key: idempotencyKey, ownerKey: owner, runId, action, requestHash: hash },
      });
      return { replayed: false };
    });
  } catch (error) {
    return recoverIdempotency(error, idempotencyKey, owner, hash);
  }
}

function replay(existing: { ownerKey: string; requestHash: string; runId: string }, owner: string, hash: string) {
  if (existing.ownerKey !== owner || existing.requestHash !== hash) {
    throw new AppError("This idempotency key was already used for a different action.", "IDEMPOTENCY_CONFLICT", 409);
  }
  return { runId: existing.runId, replayed: true };
}

async function recoverIdempotency(error: unknown, key: string, owner: string, hash: string): Promise<{ runId: string; replayed: boolean }> {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const existing = await getDb().idempotencyRecord.findUnique({ where: { key } });
    if (existing) return replay(existing, owner, hash);
  }
  throw error;
}

async function mustOwn(owner: string, runId: string): Promise<WorkflowRun> {
  if (!/^[a-z0-9]{8,40}$/i.test(runId)) throw new AppError("Run not found.", "NOT_FOUND", 404);
  const run = await getDb().workflowRun.findFirst({ where: { id: runId, ownerKey: owner } });
  if (!run) throw new AppError("Run not found.", "NOT_FOUND", 404);
  return run;
}

async function loadRun(owner: string, runId: string) {
  if (!/^[a-z0-9]{8,40}$/i.test(runId)) throw new AppError("Run not found.", "NOT_FOUND", 404);
  const run = await getDb().workflowRun.findFirst({
    where: { id: runId, ownerKey: owner },
    include: {
      project: { include: { brand: true } },
      brief: true,
      stages: {
        include: { sources: true, claims: true, edits: true, checkpoints: { orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "asc" },
      },
      events: { orderBy: { id: "desc" }, take: 200 },
    },
  });
  if (!run) throw new AppError("Run not found.", "NOT_FOUND", 404);
  return run;
}

async function claimExecution(
  tx: Prisma.TransactionClient,
  execution: StageExecution,
  expectedRevision: number,
  from: string[],
  data: Prisma.StageExecutionUpdateManyMutationInput,
) {
  const updated = await tx.stageExecution.updateMany({
    where: { id: execution.id, revision: expectedRevision, status: { in: from } },
    data: { ...data, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new LostRaceError();
}

async function currentStage(tx: Prisma.TransactionClient, runId: string, stage: StageName): Promise<StageExecution> {
  const execution = await tx.stageExecution.findFirst({ where: { runId, stage, isCurrent: true } });
  if (!execution) throw new AppError(`${STAGE_META[stage].label} has not run yet.`, "CONFLICT", 409);
  return execution;
}

async function assertReview(tx: Prisma.TransactionClient, run: WorkflowRun, execution: StageExecution, expectedRevision: number) {
  const review = reviewStateFor(execution.stage as StageName);
  if (!review || run.state !== review) throw new AppError("This stage is not waiting for approval.", "CONFLICT", 409);
  if (execution.status !== "AWAITING_REVIEW") throw new AppError("This stage is not waiting for approval.", "CONFLICT", 409);
  if (execution.revision !== expectedRevision) {
    throw new AppError("This stage changed since you opened it. Reload before approving.", "STALE_VERSION", 409);
  }
  const rows = await tx.stageExecution.findMany({ where: { runId: run.id, isCurrent: true } });
  const versions = Object.fromEntries(
    STAGE_ORDER.map((stage) => [stage, rows.find((row) => row.stage === stage)?.version ?? null]),
  ) as Record<StageName, number | null>;
  const reason = staleReasonFor(execution, versions);
  if (reason) throw new AppError(reason, "STALE_VERSION", 409);
  const open = await tx.checkpoint.count({ where: { stageExecutionId: execution.id, status: "OPEN" } });
  if (open !== 1) throw new AppError("This checkpoint is no longer open.", "CONFLICT", 409);
}

function assertEditable(run: WorkflowRun, execution: StageExecution) {
  if (execution.status === "STALE" || execution.staleReason) {
    throw new AppError("This stage is stale. Regenerate it instead of editing the old version.", "STALE_VERSION", 409);
  }
  const stage = execution.stage as StageName;
  const review = reviewStateFor(stage);
  const reviewing = review && run.state === review && execution.status === "AWAITING_REVIEW";
  const rejected = run.state === "BLOCKED" && run.activeStage === stage && execution.status === "REJECTED";
  const finalCopy = stage === "REPURPOSE" && run.state === "COMPLETED" && execution.status === "COMPLETED";
  if (!reviewing && !rejected && !finalCopy) {
    throw new AppError("This version is approved. Regenerate the stage to change it.", "CONFLICT", 409);
  }
}

function inputVersions(stage: StageName, rows: StageExecution[]): Partial<Record<StageName, number>> {
  const needed = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage));
  const map: Partial<Record<StageName, number>> = {};
  for (const name of needed) {
    const row = rows.find((item) => item.stage === name && item.isCurrent);
    if (!row || (row.status !== "APPROVED" && row.status !== "COMPLETED")) {
      throw new AppError(`${STAGE_META[name].label} has to be approved before ${STAGE_META[stage].label} can run.`, "STAGE_NOT_READY", 409);
    }
    map[name] = row.version;
  }
  return map;
}

function assertMode(mode: "mock" | "live") {
  if (mode === "live" && !liveAiConfigured()) {
    throw new AppError("Live mode needs AI_API_KEY. Demo mode works without a key.", "MISCONFIGURED", 400);
  }
}

function materialize(input: CreateInput) {
  if (input.kind === "demo") {
    const pack = demoPackage(input.demoId);
    if (!pack) throw new AppError("Unknown demo brief.", "VALIDATION", 400);
    return {
      projectName: pack.projectName,
      title: pack.title,
      rawBrief: pack.rawBrief,
      audience: pack.audience,
      contentGoal: pack.contentGoal,
      category: pack.id,
      brand: pack.brand,
    };
  }
  return {
    projectName: input.projectName,
    title: input.title,
    rawBrief: input.rawBrief,
    audience: input.audience,
    contentGoal: input.contentGoal,
    category: "custom",
    brand: input.brand ?? null,
  };
}
