import type { AIProvider, CompletionArgs } from "@/server/ai/provider";
import { AIProviderError, AITimeoutError, MalformedModelOutputError } from "@/server/errors";
import { stripFences } from "@/domain/text";

export class LiveAIProvider implements AIProvider {
  readonly name = "live";

  async completeStructured<T>(args: CompletionArgs<T>): Promise<T> {
    const key = process.env.AI_API_KEY;
    if (!key) throw new AIProviderError("Live mode needs AI_API_KEY. Demo mode works without it.", false);
    const base = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.AI_MODEL ?? "gpt-4o-mini";
    const timeout = Number(process.env.AI_TIMEOUT_MS ?? 45000);
    let response: Response;
    try {
      response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: args.system },
            { role: "user", content: args.prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new AITimeoutError();
      throw new AIProviderError("The model provider could not be reached.", true);
    }
    if (!response.ok) {
      throw new AIProviderError(`The model provider returned HTTP ${response.status}.`, response.status >= 500 || response.status === 429);
    }
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new MalformedModelOutputError("The model response did not include text.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(content));
    } catch {
      throw new MalformedModelOutputError("The model response was not valid JSON.");
    }
    const result = args.schema.safeParse(parsed);
    if (!result.success) throw new MalformedModelOutputError(result.error.issues[0]?.message ?? "Schema validation failed.");
    return result.data;
  }
}
