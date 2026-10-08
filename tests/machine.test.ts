import { describe, expect, it } from "vitest";
import { InvalidTransitionError, assertTransition, canTransition } from "@/domain/stages";

describe("workflow state machine", () => {
  it("allows the happy-path transitions", () => {
    expect(canTransition("DRAFT_CREATED", "RESEARCH_RUNNING")).toBe(true);
    expect(canTransition("RESEARCH_RUNNING", "RESEARCH_REVIEW")).toBe(true);
    expect(canTransition("RESEARCH_REVIEW", "OUTLINE_RUNNING")).toBe(true);
    expect(canTransition("OUTLINE_REVIEW", "DRAFT_RUNNING")).toBe(true);
    expect(canTransition("DRAFT_REVIEW", "EDITORIAL_RUNNING")).toBe(true);
    expect(canTransition("EDITORIAL_REVIEW", "REPURPOSE_RUNNING")).toBe(true);
    expect(canTransition("REPURPOSE_RUNNING", "COMPLETED")).toBe(true);
  });

  it("rejects skipping from research to repurpose", () => {
    expect(canTransition("RESEARCH_RUNNING", "REPURPOSE_RUNNING")).toBe(false);
    expect(() => assertTransition("RESEARCH_RUNNING", "REPURPOSE_RUNNING")).toThrow(InvalidTransitionError);
  });

  it("rejects an approval transition from a running state", () => {
    expect(canTransition("OUTLINE_RUNNING", "DRAFT_RUNNING")).toBe(false);
    expect(canTransition("RESEARCH_RUNNING", "COMPLETED")).toBe(false);
    expect(canTransition("FAILED", "COMPLETED")).toBe(false);
    expect(canTransition("CANCELLED", "DRAFT_RUNNING")).toBe(false);
    expect(canTransition("RESEARCH_REVIEW", "REPURPOSE_RUNNING")).toBe(false);
  });

  it("only lets a retry return to the active stage", () => {
    expect(canTransition("RETRYING", "RESEARCH_RUNNING", { activeStage: "RESEARCH" })).toBe(true);
    expect(canTransition("RETRYING", "OUTLINE_RUNNING", { activeStage: "RESEARCH" })).toBe(false);
  });

  it("allows regeneration from a later review and from completed", () => {
    expect(canTransition("EDITORIAL_REVIEW", "RESEARCH_RUNNING")).toBe(true);
    expect(canTransition("COMPLETED", "OUTLINE_RUNNING")).toBe(true);
    expect(canTransition("CANCELLED", "RESEARCH_RUNNING")).toBe(false);
  });
});
