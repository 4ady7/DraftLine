import type { ZodType } from "zod";
import { getDb } from "@/server/db";
import { emitEvent } from "@/server/events";
import { ToolFailedError } from "@/server/errors";

export type ToolContext = {
  runId: string;
  stageExecutionId: string;
};

export async function runTool<TInput, TOutput>(
  ctx: ToolContext,
  tool: {
    name: string;
    label: string;
    inputSchema: ZodType<TInput>;
    outputSchema: ZodType<TOutput>;
    execute: (input: TInput) => Promise<TOutput>;
  },
  rawInput: unknown,
): Promise<TOutput> {
  const started = Date.now();
  const parsedInput = tool.inputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const message = `The ${tool.label} input was invalid.`;
    await record(ctx, tool.name, "FAILED", rawInput, null, message, false, Date.now() - started);
    throw new ToolFailedError(message, false);
  }
  await emitEvent(ctx.runId, "tool_started", `${tool.label} started`);
  try {
    const output = await tool.execute(parsedInput.data);
    const parsedOutput = tool.outputSchema.safeParse(output);
    if (!parsedOutput.success) {
      const message = `The ${tool.label} returned a response the workflow could not use.`;
      await record(ctx, tool.name, "FAILED", parsedInput.data, output, message, true, Date.now() - started);
      throw new ToolFailedError(message, true);
    }
    await record(ctx, tool.name, "SUCCEEDED", parsedInput.data, parsedOutput.data, null, false, Date.now() - started);
    await emitEvent(ctx.runId, "tool_result", toolResultMessage(tool.name, parsedOutput.data));
    return parsedOutput.data;
  } catch (error) {
    if (error instanceof ToolFailedError) throw error;
    const retryable = !(error instanceof ToolFailedError);
    const message = error instanceof Error ? error.message : `${tool.label} failed.`;
    await record(ctx, tool.name, "FAILED", parsedInput.data, null, message, retryable, Date.now() - started);
    await emitEvent(ctx.runId, "tool_result", message);
    if (error instanceof Error && error.name === "SearchTimeoutError") throw error;
    if (error instanceof Error && "retryable" in error) throw error;
    throw error;
  }
}

function toolResultMessage(name: string, output: unknown): string {
  if (name === "webSearch" && output && typeof output === "object" && "results" in output && "provider" in output) {
    const results = (output as { results: unknown[]; provider: string }).results.length;
    const provider = (output as { provider: string }).provider;
    return provider === "demo-corpus" ? `Demo corpus returned ${results} sources` : `Web search returned ${results} sources`;
  }
  if (name === "brandVoice") {
    const profile = (output as { profile?: { brandName?: string } | null }).profile;
    return profile ? `Brand profile loaded for ${profile.brandName}` : "No brand profile is attached. The stage will continue without one.";
  }
  return "Tool completed";
}

async function record(
  ctx: ToolContext,
  toolName: string,
  status: string,
  input: unknown,
  output: unknown,
  error: string | null,
  retryable: boolean,
  durationMs: number,
) {
  await getDb().toolExecution.create({
    data: {
      runId: ctx.runId,
      stageExecutionId: ctx.stageExecutionId,
      toolName,
      status,
      inputJson: JSON.stringify(input).slice(0, 8000),
      outputJson: output == null ? null : JSON.stringify(output).slice(0, 20000),
      error,
      retryable,
      durationMs,
    },
  });
}
