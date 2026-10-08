import type { RunState, StageName } from "@/domain/stages";
import type {
  BrandProfileInput,
  DraftOutput,
  EditorialOutput,
  OutlineOutput,
  Provenance,
  RepurposeOutput,
  ResearchOutput,
  Verification,
} from "@/domain/schemas";

export type StageStatus =
  | "WAITING"
  | "RUNNING"
  | "AWAITING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "FAILED"
  | "STALE"
  | "COMPLETED"
  | "CANCELLED";

export type StageOutput = ResearchOutput | OutlineOutput | DraftOutput | EditorialOutput | RepurposeOutput;

export type StageView = {
  stage: StageName;
  label: string;
  purpose: string;
  status: StageStatus;
  version: number | null;
  revision: number | null;
  attemptCount: number;
  maxRetries: number;
  manualRetries: number;
  lastError: string | null;
  errorRetryable: boolean;
  stale: boolean;
  staleReason: string | null;
  inputVersions: Partial<Record<StageName, number>>;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  humanEdited: boolean;
  editedFields: string[];
  editCount: number;
  checkpoint: { id: string; status: string; reason: string | null } | null;
  output: StageOutput | null;
  article: string | null;
  sources: Array<{
    id: string;
    url: string;
    title: string;
    publisher: string;
    retrievedAt: string;
    excerpt: string;
    relevance: string;
    provider: "demo-corpus" | "tavily";
  }>;
  claims: Array<{
    id: string;
    text: string;
    sourceUrl: string | null;
    verification: Verification;
    provenance: Provenance;
  }>;
};

export type RunView = {
  id: string;
  state: RunState;
  mode: "mock" | "live";
  activeStage: StageName | null;
  lastError: string | null;
  errorRetryable: boolean;
  failedStage: StageName | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  project: { id: string; name: string };
  brief: {
    id: string;
    title: string;
    rawBrief: string;
    audience: string;
    contentGoal: string;
    category: string;
  };
  brand: BrandProfileInput | null;
  stages: StageView[];
  events: Array<{
    id: number;
    type: string;
    message: string;
    createdAt: string;
  }>;
  edits: Array<{
    id: string;
    stage: StageName;
    version: number;
    fieldPath: string;
    beforeText: string;
    afterText: string;
    createdAt: string;
  }>;
  capabilities: {
    faultSimulation: boolean;
    liveAi: boolean;
    liveSearch: boolean;
  };
};
