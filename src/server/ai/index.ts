import type { StageName } from "@/domain/stages";
import type { ZodType } from "zod";
import { LiveAIProvider } from "@/server/ai/live";
import { MockAIProvider } from "@/server/ai/mock";
import { consumeFault, type AIProvider, type CompletionArgs } from "@/server/ai/provider";

export function providerFor(mode: "mock" | "live"): AIProvider {
  return mode === "live" ? new LiveAIProvider() : new MockAIProvider();
}

export async function completeStructured<T>(provider: AIProvider, args: CompletionArgs<T>): Promise<T> {
  await consumeFault(args.runId, args.stage, "ai_timeout");
  await consumeFault(args.runId, args.stage, "malformed_output");
  return provider.completeStructured(args);
}

export type { AIProvider, CompletionArgs };
export type StructuredCall = <T>(args: {
  stage: StageName;
  schemaName: string;
  schema: ZodType<T>;
  system: string;
  prompt: string;
}) => Promise<T>;
