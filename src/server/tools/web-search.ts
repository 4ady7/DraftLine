import { z } from "zod";
import { searchOutputSchema, searchResultSchema, type SearchOutput } from "@/domain/schemas";
import { isPublicHttpUrl } from "@/domain/text";
import { consumeFault } from "@/server/ai/provider";
import { demoPackage } from "@/server/demo/catalog";
import { SearchTimeoutError, ToolFailedError } from "@/server/errors";
import type { StageName } from "@/domain/stages";

const inputSchema = z.object({
  query: z.string().trim().min(3).max(300),
  limit: z.number().int().min(1).max(8),
  category: z.string().max(80).optional(),
  contextExcerpt: z.string().max(1000).optional(),
});

const tavilySchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().optional().default(""),
        url: z.string().url(),
        content: z.string().optional().default(""),
      }),
    )
    .default([]),
});

export function createWebSearchTool(args: { runId: string; stage: StageName; mode: "mock" | "live" }) {
  return {
    name: "webSearch",
    label: args.mode === "mock" ? "Demo corpus search" : "Web search",
    inputSchema,
    outputSchema: searchOutputSchema,
    async execute(input: z.infer<typeof inputSchema>): Promise<SearchOutput> {
      await consumeFault(args.runId, args.stage, "search_timeout");
      if (args.mode === "mock") return demoSearch(input);
      return tavilySearch(input);
    },
  };
}

function demoSearch(input: z.infer<typeof inputSchema>): SearchOutput {
  const retrievedAt = new Date().toISOString();
  const pack = input.category ? demoPackage(input.category) : null;
  if (!pack) {
    const excerpt = (input.contextExcerpt || input.query).slice(0, 700);
    const result = searchResultSchema.parse({
      id: "submitted-brief",
      url: "https://demo.draftline.local/corpus/custom/submitted-brief",
      title: "Submitted brief",
      publisher: "Draftline demo corpus",
      excerpt: excerpt || "The submitted brief did not include enough text to quote.",
      relevance: "Demo mode has no external sources for a custom topic. This entry is the brief itself, not independent evidence.",
      retrievedAt,
      provider: "demo-corpus",
      demoClaim: excerpt.slice(0, 280) || input.query,
      demoVerification: "UNVERIFIED",
    });
    return { query: input.query, provider: "demo-corpus", results: [result] };
  }
  const results = pack.corpus.slice(0, input.limit).map((source) =>
    searchResultSchema.parse({
      ...source,
      publisher: "Draftline demo corpus",
      retrievedAt,
      provider: "demo-corpus",
      demoClaim: source.claim,
      demoVerification: source.verification,
    }),
  );
  return { query: input.query, provider: "demo-corpus", results };
}

async function tavilySearch(input: z.infer<typeof inputSchema>): Promise<SearchOutput> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw new ToolFailedError("No search provider is configured. Set TAVILY_API_KEY, or run this brief in demo mode.", false);
  }
  const timeout = Number(process.env.SEARCH_TIMEOUT_MS ?? 15000);
  let response: Response;
  try {
    response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: AbortSignal.timeout(timeout),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query: input.query, max_results: input.limit, include_answer: false }),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new SearchTimeoutError();
    throw new ToolFailedError("The search provider could not be reached.", true);
  }
  if (!response.ok) {
    throw new ToolFailedError(`The search provider returned HTTP ${response.status}.`, response.status >= 500 || response.status === 429);
  }
  const body = tavilySchema.safeParse(await response.json());
  if (!body.success) throw new ToolFailedError("The search provider returned a response the workflow could not use.", true);
  const retrievedAt = new Date().toISOString();
  const results = [];
  for (const result of body.data.results) {
    if (!isPublicHttpUrl(result.url)) continue;
    let host = "unknown";
    try {
      host = new URL(result.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const parsed = searchResultSchema.safeParse({
      id: `web-${results.length + 1}`,
      url: result.url,
      title: result.title || host,
      publisher: host,
      excerpt: (result.content || result.title || "No excerpt was returned.").slice(0, 1800),
      relevance: "Returned by the configured web search provider for this query.",
      retrievedAt,
      provider: "tavily",
    });
    if (!parsed.success) continue;
    results.push(parsed.data);
    if (results.length >= input.limit) break;
  }
  return { query: input.query, provider: "tavily", results };
}
