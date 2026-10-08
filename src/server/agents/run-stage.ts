import type { StageName } from "@/domain/stages";
import type {
  BrandProfileInput,
  DraftOutput,
  EditorialOutput,
  OutlineOutput,
  RepurposeOutput,
  ResearchOutput,
} from "@/domain/schemas";
import {
  draftOutputSchema,
  editorialOutputSchema,
  outlineOutputSchema,
  repurposePackageSchema,
  researchModelSchema,
} from "@/domain/schemas";
import { blocksToMarkdown } from "@/domain/text";
import { completeStructured, providerFor, type AIProvider } from "@/server/ai/index";
import { constrainResearch, filterEvidenceRefs, knownEvidence } from "@/server/agents/guards";
import { deriveVerdict, heuristicFindings } from "@/server/agents/heuristics";
import { block, SYSTEM_BASE } from "@/server/agents/prompts";
import { emitEvent } from "@/server/events";
import { MalformedModelOutputError, ToolFailedError } from "@/server/errors";
import { createBrandVoiceTool } from "@/server/tools/brand-voice";
import { runTool } from "@/server/tools/run-tool";
import { createWebSearchTool } from "@/server/tools/web-search";

export type Upstream = {
  research?: ResearchOutput;
  outline?: OutlineOutput;
  draft?: DraftOutput;
  editorial?: EditorialOutput;
};

export type AgentRun = {
  runId: string;
  projectId: string;
  stageExecutionId: string;
  stage: StageName;
  mode: "mock" | "live";
  brief: {
    title: string;
    rawBrief: string;
    audience: string;
    contentGoal: string;
    category: string;
  };
  upstream: Upstream;
};

const ALLOWED: Record<StageName, Array<"webSearch" | "brandVoice">> = {
  RESEARCH: ["webSearch", "brandVoice"],
  OUTLINE: ["brandVoice"],
  DRAFT: ["brandVoice"],
  EDITORIAL: ["brandVoice"],
  REPURPOSE: [],
};

export async function runAgent(args: AgentRun): Promise<ResearchOutput | OutlineOutput | DraftOutput | EditorialOutput | RepurposeOutput> {
  const provider = providerFor(args.mode);
  switch (args.stage) {
    case "RESEARCH":
      return runResearch(args, provider);
    case "OUTLINE":
      return runOutline(args, provider);
    case "DRAFT":
      return runDraft(args, provider);
    case "EDITORIAL":
      return runEditorial(args, provider);
    case "REPURPOSE":
      return runRepurpose(args, provider);
  }
}

async function runResearch(args: AgentRun, provider: AIProvider): Promise<ResearchOutput> {
  await emitEvent(args.runId, "agent_message", "Researcher started");
  const searchTool = createWebSearchTool({ runId: args.runId, stage: "RESEARCH", mode: args.mode });
  assertAllowed(args.stage, "webSearch");
  const search = await runTool(
    toolCtx(args),
    searchTool,
    {
      query: `${args.brief.title}. ${args.brief.contentGoal}`.slice(0, 280),
      limit: 5,
      category: args.brief.category,
      contextExcerpt: args.brief.rawBrief.slice(0, 700),
    },
  );
  if (search.results.length === 0) {
    throw new ToolFailedError("Search returned no sources, so research stopped.", false);
  }
  await emitEvent(args.runId, "stage_progress", `Collected ${search.results.length} sources`);
  const brand = await loadBrand(args);
  const model = await completeStructured(provider, {
    runId: args.runId,
    stage: "RESEARCH",
    schemaName: "ResearchOutput",
    schema: researchModelSchema,
    system: `${SYSTEM_BASE}\nSelect only URLs from SOURCES_JSON. Copy claims from the excerpts. Use NEEDS_CURRENT_DATA when a number is not backed by a primary source in the excerpt.`,
    prompt: [block("BRIEF", args.brief), block("BRAND", brand), block("SOURCES", search.results)].join("\n\n"),
  });
  const output = constrainResearch(model, search.results);
  await emitEvent(args.runId, "stage_progress", `Extracted ${output.claims.length} claims`);
  return output;
}

async function runOutline(args: AgentRun, provider: AIProvider): Promise<OutlineOutput> {
  await emitEvent(args.runId, "agent_message", "Outliner started");
  const research = required(args.upstream.research, "Approved research");
  const brand = await loadBrand(args);
  const model = await completeStructured(provider, {
    runId: args.runId,
    stage: "OUTLINE",
    schemaName: "OutlineOutput",
    schema: outlineOutputSchema,
    system: `${SYSTEM_BASE}\nEvidence references must be source URLs or claim ids from RESEARCH_JSON. Do not add sources.`,
    prompt: [block("BRIEF", args.brief), block("BRAND", brand), block("RESEARCH", research)].join("\n\n"),
  });
  const allowed = knownEvidence(research);
  let removed = 0;
  const sections = model.sections.map((section) => {
    const filtered = filterEvidenceRefs(section.evidenceRefs, allowed);
    removed += filtered.removed;
    return { ...section, evidenceRefs: filtered.kept };
  });
  if (removed > 0) {
    await emitEvent(args.runId, "stage_progress", `Removed ${removed} evidence references that were not in the approved research`);
  }
  return outlineOutputSchema.parse({ ...model, sections });
}

async function runDraft(args: AgentRun, provider: AIProvider): Promise<DraftOutput> {
  await emitEvent(args.runId, "agent_message", "Writer started");
  const research = required(args.upstream.research, "Approved research");
  const outline = required(args.upstream.outline, "Approved outline");
  const brand = await loadBrand(args);
  const model = await completeStructured(provider, {
    runId: args.runId,
    stage: "DRAFT",
    schemaName: "DraftOutput",
    schema: draftOutputSchema,
    system: `${SYSTEM_BASE}\nMark a paragraph SOURCE_GROUNDED only when its text is a claim from RESEARCH_JSON and you include that claim's source URL. Use BRAND_GUIDANCE only for the supplied example line. Everything else is MODEL_GENERATED.`,
    prompt: [block("BRIEF", args.brief), block("BRAND", brand), block("RESEARCH", research), block("OUTLINE", outline)].join("\n\n"),
  });
  const urls = new Set(research.sources.map((source) => source.url));
  let downgraded = 0;
  const blocks = model.blocks.map((blockItem) => {
    const sourceUrls = blockItem.sourceUrls.filter((url) => urls.has(url));
    if (blockItem.provenance === "SOURCE_GROUNDED" && sourceUrls.length === 0) {
      downgraded += 1;
      return { ...blockItem, provenance: "UNVERIFIED" as const, sourceUrls: [] };
    }
    return { ...blockItem, sourceUrls };
  });
  if (downgraded > 0) {
    await emitEvent(args.runId, "stage_progress", `Marked ${downgraded} paragraphs unverified because their sources were not in the approved research`);
  }
  return draftOutputSchema.parse({ ...model, blocks });
}

async function runEditorial(args: AgentRun, provider: AIProvider): Promise<EditorialOutput> {
  await emitEvent(args.runId, "agent_message", "Editorial checker started");
  const research = required(args.upstream.research, "Approved research");
  const outline = required(args.upstream.outline, "Approved outline");
  const draft = required(args.upstream.draft, "Approved draft");
  const brand = await loadBrand(args);
  const ruled = heuristicFindings({ draft, research, outline, brand });
  const model = await completeStructured(provider, {
    runId: args.runId,
    stage: "EDITORIAL",
    schemaName: "EditorialOutput",
    schema: editorialOutputSchema,
    system: `${SYSTEM_BASE}\nDo not rewrite the article. Return findings only. affectedExcerpt must be copied from the draft. If you have no additional finding, return an empty findings array.`,
    prompt: [block("BRIEF", args.brief), block("BRAND", brand), block("DRAFT", { ...draft, article: blocksToMarkdown(draft.blocks) }), block("FINDINGS_ALREADY_FOUND", ruled)].join("\n\n"),
  });
  const article = blocksToMarkdown(draft.blocks);
  const extra = model.findings
    .filter((finding) => article.includes(finding.affectedExcerpt))
    .map((finding, index) => ({ ...finding, id: `model-${index + 1}`, origin: "model" as const }));
  const findings = [...ruled, ...extra].slice(0, 40);
  return editorialOutputSchema.parse({ verdict: deriveVerdict(findings), findings });
}

async function runRepurpose(args: AgentRun, provider: AIProvider): Promise<RepurposeOutput> {
  await emitEvent(args.runId, "agent_message", "Repurposer started");
  const draft = required(args.upstream.draft, "Approved draft");
  const editorial = required(args.upstream.editorial, "Editorial findings");
  const brand = await loadBrand(args);
  const model = await completeStructured(provider, {
    runId: args.runId,
    stage: "REPURPOSE",
    schemaName: "RepurposeOutput",
    schema: repurposePackageSchema,
    system: `${SYSTEM_BASE}\nEach variant needs a distinct purpose. Do not repeat a high-severity excerpt from EDITORIAL_JSON. The X variant must be 280 characters or fewer. Do not present derivative copy as sourced fact.`,
    prompt: [block("BRIEF", args.brief), block("BRAND", brand), block("DRAFT", draft), block("EDITORIAL", editorial)].join("\n\n"),
  });
  return repurposePackageSchema.parse(model);
}

async function loadBrand(args: AgentRun): Promise<BrandProfileInput | null> {
  if (!ALLOWED[args.stage].includes("brandVoice")) return null;
  const tool = createBrandVoiceTool();
  const result = await runTool(toolCtx(args), tool, { projectId: args.projectId });
  return result.profile;
}

function toolCtx(args: AgentRun) {
  return { runId: args.runId, stageExecutionId: args.stageExecutionId };
}

function assertAllowed(stage: StageName, tool: "webSearch" | "brandVoice") {
  if (!ALLOWED[stage].includes(tool)) {
    throw new MalformedModelOutputError(`${stage} is not allowed to call ${tool}.`);
  }
}

function required<T>(value: T | undefined, label: string): T {
  if (!value) throw new MalformedModelOutputError(`${label} is missing, so this stage cannot start.`);
  return value;
}
