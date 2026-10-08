export const RUN_STATES = [
  "DRAFT_CREATED",
  "RESEARCH_RUNNING",
  "RESEARCH_REVIEW",
  "OUTLINE_RUNNING",
  "OUTLINE_REVIEW",
  "DRAFT_RUNNING",
  "DRAFT_REVIEW",
  "EDITORIAL_RUNNING",
  "EDITORIAL_REVIEW",
  "REPURPOSE_RUNNING",
  "COMPLETED",
  "FAILED",
  "RETRYING",
  "BLOCKED",
  "CANCELLED",
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const STAGES = ["RESEARCH", "OUTLINE", "DRAFT", "EDITORIAL", "REPURPOSE"] as const;

export type StageName = (typeof STAGES)[number];

export const STAGE_ORDER: StageName[] = [...STAGES];

export const STAGE_META: Record<StageName, { label: string; purpose: string }> = {
  RESEARCH: {
    label: "Research",
    purpose: "Find sources and extract claims the draft can actually use.",
  },
  OUTLINE: {
    label: "Outline",
    purpose: "Turn approved research into a structure an editor can argue with.",
  },
  DRAFT: {
    label: "Draft",
    purpose: "Write the first full article from the approved outline.",
  },
  EDITORIAL: {
    label: "Editorial",
    purpose: "Surface factual, structural, and voice problems without rewriting.",
  },
  REPURPOSE: {
    label: "Repurpose",
    purpose: "Derive distinct social and newsletter versions from the approved article.",
  },
};

export const CHECKPOINT_STAGES = new Set<StageName>(["RESEARCH", "OUTLINE", "DRAFT", "EDITORIAL"]);

const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  DRAFT_CREATED: ["RESEARCH_RUNNING", "CANCELLED"],
  RESEARCH_RUNNING: ["RESEARCH_REVIEW", "RETRYING", "FAILED", "CANCELLED"],
  RESEARCH_REVIEW: ["OUTLINE_RUNNING", "RESEARCH_RUNNING", "BLOCKED", "CANCELLED"],
  OUTLINE_RUNNING: ["OUTLINE_REVIEW", "RETRYING", "FAILED", "CANCELLED"],
  OUTLINE_REVIEW: ["DRAFT_RUNNING", "OUTLINE_RUNNING", "RESEARCH_RUNNING", "BLOCKED", "CANCELLED"],
  DRAFT_RUNNING: ["DRAFT_REVIEW", "RETRYING", "FAILED", "CANCELLED"],
  DRAFT_REVIEW: ["EDITORIAL_RUNNING", "DRAFT_RUNNING", "OUTLINE_RUNNING", "RESEARCH_RUNNING", "BLOCKED", "CANCELLED"],
  EDITORIAL_RUNNING: ["EDITORIAL_REVIEW", "RETRYING", "FAILED", "CANCELLED"],
  EDITORIAL_REVIEW: [
    "REPURPOSE_RUNNING",
    "EDITORIAL_RUNNING",
    "DRAFT_RUNNING",
    "OUTLINE_RUNNING",
    "RESEARCH_RUNNING",
    "BLOCKED",
    "CANCELLED",
  ],
  REPURPOSE_RUNNING: ["COMPLETED", "RETRYING", "FAILED", "CANCELLED"],
  COMPLETED: ["RESEARCH_RUNNING", "OUTLINE_RUNNING", "DRAFT_RUNNING", "EDITORIAL_RUNNING", "REPURPOSE_RUNNING"],
  FAILED: ["RETRYING", "RESEARCH_RUNNING", "OUTLINE_RUNNING", "DRAFT_RUNNING", "EDITORIAL_RUNNING", "REPURPOSE_RUNNING", "CANCELLED"],
  RETRYING: ["RESEARCH_RUNNING", "OUTLINE_RUNNING", "DRAFT_RUNNING", "EDITORIAL_RUNNING", "REPURPOSE_RUNNING", "FAILED", "CANCELLED"],
  BLOCKED: [
    "RESEARCH_REVIEW",
    "OUTLINE_REVIEW",
    "DRAFT_REVIEW",
    "EDITORIAL_REVIEW",
    "RESEARCH_RUNNING",
    "OUTLINE_RUNNING",
    "DRAFT_RUNNING",
    "EDITORIAL_RUNNING",
    "REPURPOSE_RUNNING",
    "CANCELLED",
  ],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";

  constructor(
    readonly from: RunState,
    readonly to: RunState,
    detail?: string,
  ) {
    super(detail ?? `Cannot move from ${from} to ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

export type TransitionContext = {
  activeStage?: StageName | null;
};

export function isRunState(value: string): value is RunState {
  return (RUN_STATES as readonly string[]).includes(value);
}

export function isStageName(value: string): value is StageName {
  return (STAGES as readonly string[]).includes(value);
}

export function canTransition(from: RunState, to: RunState, ctx: TransitionContext = {}): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  if (from === "RETRYING" && to.endsWith("_RUNNING")) {
    const stage = stageForState(to);
    if (!stage || stage !== ctx.activeStage) return false;
  }
  return true;
}

export function assertTransition(from: RunState, to: RunState, ctx: TransitionContext = {}): void {
  if (!canTransition(from, to, ctx)) {
    const hint =
      from === "RETRYING" && to.endsWith("_RUNNING")
        ? ` Retry must return to ${ctx.activeStage ?? "the active stage"}.`
        : "";
    throw new InvalidTransitionError(from, to, `Cannot move from ${from} to ${to}.${hint}`);
  }
}

export function stageForState(state: RunState): StageName | null {
  if (state.startsWith("RESEARCH_")) return "RESEARCH";
  if (state.startsWith("OUTLINE_")) return "OUTLINE";
  if (state.startsWith("DRAFT_")) return "DRAFT";
  if (state.startsWith("EDITORIAL_")) return "EDITORIAL";
  if (state.startsWith("REPURPOSE_")) return "REPURPOSE";
  return null;
}

export function runningStateFor(stage: StageName): RunState {
  return `${stage}_RUNNING` as RunState;
}

export function reviewStateFor(stage: StageName): RunState | null {
  if (!CHECKPOINT_STAGES.has(stage)) return null;
  return `${stage}_REVIEW` as RunState;
}

export function nextStage(stage: StageName): StageName | null {
  const index = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER[index + 1] ?? null;
}

export function downstreamStages(stage: StageName): StageName[] {
  const index = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER.slice(index + 1);
}

export function isRunningState(state: RunState): boolean {
  return state.endsWith("_RUNNING");
}

export function isReviewState(state: RunState): boolean {
  return state.endsWith("_REVIEW");
}

export type RunTone = "idle" | "running" | "waiting" | "done" | "bad";

export function describeRunState(state: RunState): { label: string; tone: RunTone; detail: string } {
  switch (state) {
    case "DRAFT_CREATED":
      return { label: "Ready", tone: "idle", detail: "The brief is saved. The workflow has not started." };
    case "RESEARCH_RUNNING":
      return { label: "Researching", tone: "running", detail: "The researcher is collecting sources and claims." };
    case "RESEARCH_REVIEW":
      return { label: "Research needs you", tone: "waiting", detail: "Review the sources and claims before the outline starts." };
    case "OUTLINE_RUNNING":
      return { label: "Outlining", tone: "running", detail: "The outliner is structuring the approved research." };
    case "OUTLINE_REVIEW":
      return { label: "Outline needs you", tone: "waiting", detail: "Edit or approve the structure before the draft starts." };
    case "DRAFT_RUNNING":
      return { label: "Drafting", tone: "running", detail: "The writer is producing the first full article." };
    case "DRAFT_REVIEW":
      return { label: "Draft needs you", tone: "waiting", detail: "Read the article before the editorial check." };
    case "EDITORIAL_RUNNING":
      return { label: "Checking", tone: "running", detail: "The editorial checker is looking for problems. It will not rewrite the article." };
    case "EDITORIAL_REVIEW":
      return { label: "Editorial needs you", tone: "waiting", detail: "Review the findings, then send the article on or back." };
    case "REPURPOSE_RUNNING":
      return { label: "Repurposing", tone: "running", detail: "Derivative posts are being written from the approved article." };
    case "COMPLETED":
      return { label: "Package ready", tone: "done", detail: "The current package is complete. Upstream regeneration will mark later stages stale." };
    case "FAILED":
      return { label: "Failed", tone: "bad", detail: "A stage stopped. The last error is saved on the run." };
    case "RETRYING":
      return { label: "Retrying", tone: "running", detail: "The same stage is trying again. The pipeline did not restart." };
    case "BLOCKED":
      return { label: "Rejected", tone: "waiting", detail: "You rejected this stage. Edit it, or regenerate it. Nothing advanced." };
    case "CANCELLED":
      return { label: "Cancelled", tone: "bad", detail: "This run was cancelled. Start a new one from the brief if you want another pass." };
  }
}
