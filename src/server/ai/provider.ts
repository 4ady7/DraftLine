import type { ZodType } from "zod";
import type { StageName } from "@/domain/stages";
import { getDb } from "@/server/db";
import { AITimeoutError, DatabaseFaultError, MalformedModelOutputError, SearchTimeoutError } from "@/server/errors";

export type CompletionArgs<T> = {
  runId: string;
  stage: StageName;
  schemaName: string;
  schema: ZodType<T>;
  system: string;
  prompt: string;
};

export interface AIProvider {
  readonly name: string;
  completeStructured<T>(args: CompletionArgs<T>): Promise<T>;
}

export type FaultType = "ai_timeout" | "search_timeout" | "malformed_output" | "database_failure";

export type FaultPlan = {
  stage: StageName;
  type: FaultType;
  remaining: number;
};

export function parseFault(raw: string | null): FaultPlan | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as FaultPlan;
    if (!value || typeof value.remaining !== "number" || value.remaining < 0) return null;
    return value;
  } catch {
    return null;
  }
}

export async function consumeFault(runId: string, stage: StageName, type: FaultType): Promise<void> {
  const db = getDb();
  const run = await db.workflowRun.findUnique({ where: { id: runId } });
  const fault = parseFault(run?.faultJson ?? null);
  if (!fault || fault.stage !== stage || fault.type !== type || fault.remaining <= 0) return;
  fault.remaining -= 1;
  await db.workflowRun.update({
    where: { id: runId },
    data: { faultJson: JSON.stringify(fault) },
  });
  if (type === "ai_timeout") throw new AITimeoutError();
  if (type === "search_timeout") throw new SearchTimeoutError();
  if (type === "malformed_output") throw new MalformedModelOutputError("Simulated malformed model output.");
  if (type === "database_failure") throw new DatabaseFaultError();
}

export function stageDelay(): number {
  return Number(process.env.DRAFTLINE_STAGE_DELAY_MS ?? 280);
}

export function retryDelay(): number {
  return Number(process.env.DRAFTLINE_RETRY_DELAY_MS ?? 200);
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
