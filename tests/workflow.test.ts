import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { buildExport, toMarkdown } from "@/server/export";
import { AppError } from "@/server/errors";
import { createWebSearchTool } from "@/server/tools/web-search";
import {
  approve,
  cancel,
  createRun,
  editStage,
  getRun,
  regenerate,
  reject,
  retry,
  simulate,
  startRun,
} from "@/server/workflow/service";

const owner = randomUUID();

async function newRun(demoId: "northwind-close" | "hale-retainer" | "relay-agents" = "northwind-close") {
  const created = await createRun(owner, { kind: "demo", demoId, mode: "mock" }, randomUUID());
  return created.runId;
}

async function approveCurrent(runId: string) {
  const view = await getRun(owner, runId);
  const stage = view.stages.find((item) => item.status === "AWAITING_REVIEW");
  if (!stage?.revision) throw new Error(`No checkpoint in ${view.state}`);
  await approve(owner, runId, randomUUID(), { stage: stage.stage, expectedRevision: stage.revision }, true);
}

describe("orchestrator", () => {
  it("runs the five stages, pauses at checkpoints, and exports the package", async () => {
    const runId = await newRun();
    await startRun(owner, runId, randomUUID(), true);
    let view = await getRun(owner, runId);
    expect(view.state).toBe("RESEARCH_REVIEW");
    expect(view.stages.find((stage) => stage.stage === "RESEARCH")?.sources.length).toBeGreaterThan(0);
    expect(view.stages.find((stage) => stage.stage === "OUTLINE")?.status).toBe("WAITING");
    expect(view.events.some((event) => event.message.includes("Demo corpus"))).toBe(true);

    await approveCurrent(runId);
    view = await getRun(owner, runId);
    expect(view.state).toBe("OUTLINE_REVIEW");

    await approveCurrent(runId);
    view = await getRun(owner, runId);
    expect(view.state).toBe("DRAFT_REVIEW");
    const draft = view.stages.find((stage) => stage.stage === "DRAFT");
    expect(draft?.article).toContain("8.5");
    expect(draft?.output && "blocks" in draft.output && draft.output.blocks.some((block) => block.provenance === "SOURCE_GROUNDED")).toBe(true);

    await approveCurrent(runId);
    view = await getRun(owner, runId);
    expect(view.state).toBe("EDITORIAL_REVIEW");
    const editorial = view.stages.find((stage) => stage.stage === "EDITORIAL");
    const editorialOutput = editorial?.output && "verdict" in editorial.output ? editorial.output : null;
    expect(editorialOutput?.verdict).toBe("NEEDS_REVISION");
    expect(editorialOutput?.findings.some((finding) => finding.verificationFlag === "NEEDS_CURRENT_DATA")).toBe(true);

    await approveCurrent(runId);
    view = await getRun(owner, runId);
    expect(view.state).toBe("COMPLETED");
    const social = view.stages.find((stage) => stage.stage === "REPURPOSE");
    expect(social?.status).toBe("COMPLETED");
    expect(JSON.stringify(social?.output)).not.toContain("8.5");

    const exported = buildExport(view);
    expect(exported.article?.markdown).toContain("8.5");
    expect(exported.repurpose?.x.body.length).toBeLessThanOrEqual(280);
    expect(exported.omitted).toEqual([]);
    expect(toMarkdown(exported)).toContain("## Sources");
    expect(toMarkdown(exported)).toContain("NEEDS_CURRENT_DATA");
  });

  it("persists a human edit and feeds it to the next stage", async () => {
    const runId = await newRun();
    await startRun(owner, runId, randomUUID(), true);
    const before = await getRun(owner, runId);
    const research = before.stages.find((stage) => stage.stage === "RESEARCH")!;
    const claims = research.claims.map((claim, index) => ({ id: claim.id, text: index === 0 ? "EDITED CLAIM UNIQUE FOR THE OUTLINE" : claim.text }));
    await editStage(owner, runId, randomUUID(), {
      stage: "RESEARCH",
      expectedRevision: research.revision!,
      content: { summary: "A human rewrote the research summary.", claims },
    });
    const edited = await getRun(owner, runId);
    expect(edited.state).toBe("RESEARCH_REVIEW");
    const editedResearch = edited.stages.find((stage) => stage.stage === "RESEARCH")!;
    expect(editedResearch.humanEdited).toBe(true);
    expect(editedResearch.claims[0]?.provenance).toBe("HUMAN_EDITED");
    expect(editedResearch.claims[0]?.verification).toBe("UNVERIFIED");
    expect(edited.edits).toHaveLength(2);

    await approve(owner, runId, randomUUID(), { stage: "RESEARCH", expectedRevision: editedResearch.revision! }, true);
    const outlined = await getRun(owner, runId);
    expect(JSON.stringify(outlined.stages.find((stage) => stage.stage === "OUTLINE")?.output)).toContain("EDITED CLAIM UNIQUE FOR THE OUTLINE");
  });

  it("does not advance when a stage is rejected", async () => {
    const runId = await newRun();
    await startRun(owner, runId, randomUUID(), true);
    const view = await getRun(owner, runId);
    const research = view.stages.find((stage) => stage.stage === "RESEARCH")!;
    await reject(owner, runId, randomUUID(), { stage: "RESEARCH", expectedRevision: research.revision!, reason: "The queue point is too vague." });
    const rejected = await getRun(owner, runId);
    expect(rejected.state).toBe("BLOCKED");
    expect(rejected.stages.find((stage) => stage.stage === "OUTLINE")?.status).toBe("WAITING");
    await expect(approve(owner, runId, randomUUID(), { stage: "RESEARCH", expectedRevision: research.revision! }, true)).rejects.toBeInstanceOf(AppError);
  });

  it("treats a repeated approval as one transition", async () => {
    const runId = await newRun();
    await startRun(owner, runId, randomUUID(), true);
    const view = await getRun(owner, runId);
    const research = view.stages.find((stage) => stage.stage === "RESEARCH")!;
    const key = randomUUID();
    await approve(owner, runId, key, { stage: "RESEARCH", expectedRevision: research.revision! }, true);
    const replay = await approve(owner, runId, key, { stage: "RESEARCH", expectedRevision: research.revision! }, true);
    expect(replay.replayed).toBe(true);
    const after = await getRun(owner, runId);
    expect(after.stages.filter((stage) => stage.stage === "OUTLINE" && stage.version === 1)).toHaveLength(1);
    await expect(approve(owner, runId, randomUUID(), { stage: "RESEARCH", expectedRevision: research.revision! }, true)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("marks downstream stages stale when research is regenerated", async () => {
    const runId = await newRun();
    await startRun(owner, runId, randomUUID(), true);
    await approveCurrent(runId);
    await approveCurrent(runId);
    let view = await getRun(owner, runId);
    expect(view.state).toBe("DRAFT_REVIEW");
    await regenerate(owner, runId, randomUUID(), "RESEARCH", true);
    view = await getRun(owner, runId);
    expect(view.state).toBe("RESEARCH_REVIEW");
    expect(view.stages.find((stage) => stage.stage === "RESEARCH")?.version).toBe(2);
    expect(view.stages.find((stage) => stage.stage === "OUTLINE")?.stale).toBe(true);
    expect(view.stages.find((stage) => stage.stage === "DRAFT")?.stale).toBe(true);
    const exported = buildExport(view);
    expect(exported.article).toBeNull();
    expect(exported.omitted.some((item) => item.stage === "Draft")).toBe(true);

    const research = view.stages.find((stage) => stage.stage === "RESEARCH")!;
    await approve(owner, runId, randomUUID(), { stage: "RESEARCH", expectedRevision: research.revision! }, true);
    view = await getRun(owner, runId);
    expect(view.stages.find((stage) => stage.stage === "OUTLINE")?.version).toBe(2);
    expect(view.stages.find((stage) => stage.stage === "OUTLINE")?.inputVersions.RESEARCH).toBe(2);
    expect(view.stages.find((stage) => stage.stage === "DRAFT")?.stale).toBe(true);
  });

  it("retries a simulated search timeout and then reaches review", async () => {
    const runId = await newRun();
    await simulate(owner, runId, randomUUID(), { stage: "RESEARCH", fault: "search_timeout", times: 1 });
    await startRun(owner, runId, randomUUID(), true);
    const view = await getRun(owner, runId);
    expect(view.state).toBe("RESEARCH_REVIEW");
    const research = view.stages.find((stage) => stage.stage === "RESEARCH")!;
    expect(research.attemptCount).toBe(2);
    expect(view.events.some((event) => event.type === "retry_started")).toBe(true);
  });

  it("stops after malformed output exhausts the attempt budget and stores no fake result", async () => {
    const runId = await newRun();
    await simulate(owner, runId, randomUUID(), { stage: "RESEARCH", fault: "malformed_output", times: 3 });
    await startRun(owner, runId, randomUUID(), true);
    const view = await getRun(owner, runId);
    expect(view.state).toBe("FAILED");
    expect(view.lastError).toMatch(/schema/i);
    const research = view.stages.find((stage) => stage.stage === "RESEARCH")!;
    expect(research.output).toBeNull();
    expect(research.attemptCount).toBe(3);
    await retry(owner, runId, randomUUID(), true);
    const recovered = await getRun(owner, runId);
    expect(recovered.state).toBe("RESEARCH_REVIEW");
    expect(recovered.stages.find((stage) => stage.stage === "RESEARCH")?.sources.length).toBeGreaterThan(0);
  });

  it("hides another owner's run", async () => {
    const runId = await newRun();
    await expect(getRun(randomUUID(), runId)).rejects.toMatchObject({ status: 404 });
  });

  it("cancels without advancing", async () => {
    const runId = await newRun();
    await startRun(owner, runId, randomUUID(), true);
    await cancel(owner, runId, randomUUID());
    const view = await getRun(owner, runId);
    expect(view.state).toBe("CANCELLED");
    await expect(approveCurrent(runId)).rejects.toBeInstanceOf(AppError);
  });
});

describe("web search tool", () => {
  it("returns demo corpus sources and validates them", async () => {
    const tool = createWebSearchTool({ runId: "missing-run", stage: "RESEARCH", mode: "mock" });
    const output = await tool.execute({ query: "month-end close cadence", limit: 5, category: "northwind-close" });
    expect(tool.outputSchema.safeParse(output).success).toBe(true);
    expect(output.provider).toBe("demo-corpus");
    expect(output.results.length).toBe(5);
    expect(output.results.every((result) => result.url.startsWith("https://demo.draftline.local/"))).toBe(true);
  });

  it("fails visibly in live mode when search is not configured", async () => {
    const previous = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const tool = createWebSearchTool({ runId: "missing-run", stage: "RESEARCH", mode: "live" });
    await expect(tool.execute({ query: "month-end close cadence", limit: 3 })).rejects.toMatchObject({ retryable: false });
    if (previous) process.env.TAVILY_API_KEY = previous;
  });
});
