"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunView, StageView } from "@/domain/dto";
import type { DraftOutput, EditorialOutput, OutlineOutput, RepurposeOutput, ResearchOutput } from "@/domain/schemas";
import { describeRunState, type StageName } from "@/domain/stages";
import { formatClock, formatDuration } from "@/domain/text";

const EVENT_TYPES = [
  "stage_started",
  "agent_message",
  "tool_started",
  "tool_result",
  "stage_progress",
  "stage_completed",
  "stage_failed",
  "checkpoint_created",
  "retry_started",
  "state_changed",
  "human_edit",
  "approved",
  "rejected",
  "stale_marked",
];

export function Workspace({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pinned, setPinned] = useState<StageName | null>(null);
  const [tab, setTab] = useState<"activity" | "sources" | "checks">("activity");
  const idem = useRef(newKey());

  const reload = useCallback(async () => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      setLoadError(data.error?.message ?? "This run could not be loaded.");
      return;
    }
    setRun(data.run as RunView);
    setLoadError(null);
  }, [runId]);

  useEffect(() => {
    void reload();
    void fetch(`/api/runs/${runId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "kick" }),
    }).then(() => reload());
  }, [reload, runId]);

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/events`);
    const refresh = () => void reload();
    for (const type of EVENT_TYPES) source.addEventListener(type, refresh);
    source.onerror = () => undefined;
    return () => source.close();
  }, [reload, runId]);

  useEffect(() => {
    if (!run) return;
    const live = run.state.endsWith("_RUNNING") || run.state === "RETRYING";
    if (!live) return;
    const timer = window.setInterval(() => void reload(), 1500);
    return () => window.clearInterval(timer);
  }, [reload, run]);

  const selected = useMemo(() => {
    if (!run) return null;
    const name = pinned ?? run.activeStage ?? "RESEARCH";
    return run.stages.find((stage) => stage.stage === name) ?? run.stages[0];
  }, [pinned, run]);

  async function act(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idem.current },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.message ?? "The action failed.");
        await reload();
        return;
      }
      idem.current = newKey();
      setRun(data.run as RunView);
    } catch {
      setError("The network request failed. The run is still on the server. Refresh to see the latest state.");
    } finally {
      setPending(false);
    }
  }

  async function download(format: "markdown" | "json") {
    setError(null);
    const response = await fetch(`/api/runs/${runId}/export?format=${format}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error?.message ?? "Export failed.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `draftline-${runId}.${format === "markdown" ? "md" : "json"}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loadError) {
    return (
      <main className="shell" id="main">
        <div className="banner" data-kind="error"><p>{loadError}</p></div>
        <Link className="btn" href="/">Back to briefs</Link>
      </main>
    );
  }
  if (!run || !selected) {
    return <main className="shell" id="main"><p>Loading the run…</p></main>;
  }

  const described = describeRunState(run.state);
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          <strong>Draftline</strong>
          <span>{run.project.name}</span>
        </Link>
        <div className="topbar-meta">
          <span className="pill" data-tone={described.tone}>{run.state.endsWith("_RUNNING") ? <i className="running-dot" /> : null}{described.label}</span>
          <span className="pill">{run.mode === "mock" ? "Demo mode" : "Live model"}</span>
          <button className="btn btn-quiet" type="button" onClick={() => void reload()}>Refresh</button>
        </div>
      </header>
      <main className="workspace" id="main">
        <aside className="col col-pipeline">
          <h2>Pipeline</h2>
          <div className="pipeline-list">
            {run.stages.map((stage) => (
              <button
                key={stage.stage}
                type="button"
                className="stage-card"
                data-current={stage.stage === selected.stage ? "true" : "false"}
                aria-current={stage.stage === selected.stage ? "step" : undefined}
                onClick={() => setPinned(stage.stage)}
              >
                <div className="stage-top">
                  <span className="mark" data-status={stage.status}>{statusLabel(stage)}</span>
                  <span className="fine">{stage.version ? `v${stage.version}` : ""}</span>
                </div>
                <h3>{stage.label}</h3>
                <p>{stage.purpose}</p>
                <div className="stage-foot">
                  <span className="fine">{stageSummary(stage)}</span>
                  <span className="fine">{formatDuration(stage.durationMs) ?? ""}</span>
                </div>
              </button>
            ))}
          </div>
          {run.capabilities.faultSimulation ? (
            <details className="faults">
              <summary>Failure simulation</summary>
              <p className="fine">Arms the next attempt of a stage. This stays off in production.</p>
              <div className="btn-row">
                {(["search_timeout", "ai_timeout", "malformed_output", "database_failure"] as const).map((fault) => (
                  <button key={fault} className="btn" type="button" disabled={pending} onClick={() => act({ action: "simulate", stage: selected.stage, fault, times: 1 })}>
                    {fault.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </aside>
        <section className="col" aria-live="polite">
          <div className="work-head">
            <div>
              <p className="kicker">{run.brief.title}</p>
              <h2>{selected.label}</h2>
              <p className="fine">{described.detail}</p>
            </div>
            <div className="btn-row">
              <button className="btn" type="button" onClick={() => download("markdown")}>Export Markdown</button>
              <button className="btn" type="button" onClick={() => download("json")}>Export JSON</button>
            </div>
          </div>
          {error ? <div className="banner" data-kind="error"><p>{error}</p></div> : null}
          {run.state === "FAILED" && run.lastError ? (
            <div className="banner" data-kind="error">
              <p>{run.failedStage ? `${labelOf(run, run.failedStage)} failed because ${run.lastError.charAt(0).toLowerCase()}${run.lastError.slice(1)}` : run.lastError}</p>
              <p className="fine">Attempt {selected.stage === run.failedStage ? selected.attemptCount : run.stages.find((stage) => stage.stage === run.failedStage)?.attemptCount} of {selected.maxRetries}. {run.errorRetryable ? "This failure can be retried." : "Retry the stage, or regenerate it."}</p>
              <div className="btn-row">
                <button className="btn btn-accent" type="button" disabled={pending} onClick={() => act({ action: "retry" })}>Retry stage</button>
              </div>
            </div>
          ) : null}
          <StageBody stage={selected} run={run} pending={pending} act={act} />
        </section>
        <aside className="col col-side">
          <div className="tabs" role="tablist">
            {(["activity", "sources", "checks"] as const).map((item) => (
              <button key={item} className="btn" type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>
                {item === "activity" ? "Activity" : item === "sources" ? "Sources" : "Checks"}
              </button>
            ))}
          </div>
          {tab === "activity" ? <Activity run={run} /> : null}
          {tab === "sources" ? <Sources run={run} /> : null}
          {tab === "checks" ? <Checks run={run} /> : null}
        </aside>
      </main>
    </>
  );
}

function StageBody({
  stage,
  run,
  pending,
  act,
}: {
  stage: StageView;
  run: RunView;
  pending: boolean;
  act: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(editorSeed(stage));
  const canModerate = stage.status === "AWAITING_REVIEW" && run.state === `${stage.stage}_REVIEW` && !stage.stale;
  const canEdit = !stage.stale && stage.output && ((canModerate && stage.stage !== "EDITORIAL") || (run.state === "BLOCKED" && run.activeStage === stage.stage) || (stage.stage === "REPURPOSE" && run.state === "COMPLETED"));

  useEffect(() => {
    setEditing(false);
    setRejecting(false);
    setDraft(editorSeed(stage));
    // Reset the form only when the saved stage identity changes, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.stage, stage.version, stage.revision, stage.status]);

  return (
    <div>
      {run.mode === "mock" && stage.stage === "RESEARCH" ? (
        <div className="banner" data-kind="info"><p>Demo mode reads a fixed corpus. These sources were not fetched from the public web, and the activity log says so.</p></div>
      ) : null}
      {stage.stale ? (
        <div className="banner" data-kind="stale">
          <p>{stage.staleReason ?? "This stage is stale."}</p>
          <div className="btn-row">
            <button className="btn btn-accent" type="button" disabled={pending || run.state.endsWith("_RUNNING")} onClick={() => act({ action: "regenerate", stage: stage.stage })}>Regenerate {stage.label}</button>
          </div>
        </div>
      ) : null}
      {stage.status === "FAILED" && run.state !== "FAILED" ? <div className="banner" data-kind="error"><p>{stage.lastError}</p></div> : null}
      {stage.status === "WAITING" ? <div className="banner"><p>{run.state === "DRAFT_CREATED" ? "The brief is saved. Start the workflow when it looks right." : "Waiting for the previous stage."}</p></div> : null}
      {stage.status === "RUNNING" ? <div className="banner" data-kind="info"><p>{stage.label} is running. Attempt {Math.max(stage.attemptCount, 1)} of {stage.maxRetries}.</p></div> : null}
      {run.state === "BLOCKED" && run.activeStage === stage.stage ? (
        <div className="banner" data-kind="wait">
          <p>You rejected this stage{stage.checkpoint?.reason ? `: ${stage.checkpoint.reason}` : "."} Nothing advanced. Edit it, put it back in review, or regenerate it.</p>
        </div>
      ) : null}
      {canModerate ? <div className="banner" data-kind="wait"><p>This checkpoint is open. The next stage will not start until you approve.</p></div> : null}
      {stage.humanEdited ? <p className="unsaved">Human-edited fields: {stage.editedFields.join(", ")}</p> : null}

      {editing ? <Editor stage={stage} value={draft} onChange={setDraft} /> : <StageReadout stage={stage} />}

      <div className="btn-row" style={{ marginTop: 16 }}>
        {run.state === "DRAFT_CREATED" ? <button className="btn btn-accent" type="button" disabled={pending} onClick={() => act({ action: "start" })}>Start workflow</button> : null}
        {canModerate ? <button className="btn btn-primary" type="button" disabled={pending || dirty} onClick={() => act({ action: "approve", stage: stage.stage, expectedRevision: stage.revision })}>Approve and continue</button> : null}
        {canModerate ? <button className="btn" type="button" disabled={pending} onClick={() => setRejecting((value) => !value)}>Reject</button> : null}
        {run.state === "BLOCKED" && run.activeStage === stage.stage ? <button className="btn" type="button" disabled={pending} onClick={() => act({ action: "edit", stage: stage.stage, expectedRevision: stage.revision, content: editorSeed(stage) })}>Put back in review</button> : null}
        {canEdit && !editing ? <button className="btn" type="button" onClick={() => { setDraft(editorSeed(stage)); setEditing(true); }}>Edit</button> : null}
        {editing ? <button className="btn btn-primary" type="button" disabled={pending} onClick={() => act({ action: "edit", stage: stage.stage, expectedRevision: stage.revision, content: draft }).then(() => setEditing(false))}>Save edit</button> : null}
        {editing ? <button className="btn" type="button" onClick={() => { setDraft(editorSeed(stage)); setEditing(false); }}>Cancel</button> : null}
        {stage.version && !run.state.endsWith("_RUNNING") && run.state !== "RETRYING" && run.state !== "CANCELLED" && run.state !== "DRAFT_CREATED" ? (
          <button className="btn" type="button" disabled={pending} onClick={() => act({ action: "regenerate", stage: stage.stage })}>Regenerate stage</button>
        ) : null}
        {run.state !== "COMPLETED" && run.state !== "CANCELLED" && run.state !== "DRAFT_CREATED" ? <button className="btn btn-quiet" type="button" disabled={pending} onClick={() => act({ action: "cancel" })}>Cancel run</button> : null}
      </div>
      {dirty ? <p className="unsaved">Unsaved edit. Save or cancel before approving.</p> : null}
      {rejecting ? (
        <form className="form" style={{ marginTop: 12 }} onSubmit={(event) => { event.preventDefault(); void act({ action: "reject", stage: stage.stage, expectedRevision: stage.revision, reason }).then(() => setRejecting(false)); }}>
          <label>Rejection reason<textarea required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button className="btn btn-accent" type="submit" disabled={pending}>Save rejection</button>
        </form>
      ) : null}
      {run.state === "DRAFT_CREATED" ? <BriefPreview run={run} /> : null}
    </div>
  );
}

function BriefPreview({ run }: { run: RunView }) {
  return (
    <div className="prose" style={{ marginTop: 18 }}>
      <p>{run.brief.rawBrief}</p>
      <p className="fine">Audience: {run.brief.audience}</p>
      <p className="fine">Goal: {run.brief.contentGoal}</p>
      {run.brand ? <p className="fine">Brand: {run.brand.brandName}. Avoid: {run.brand.wordsToAvoid.join(", ") || "none listed"}.</p> : <p className="fine">No brand profile. Writer and checker will continue without one.</p>}
    </div>
  );
}

function StageReadout({ stage }: { stage: StageView }) {
  if (!stage.output) return null;
  if (stage.stage === "RESEARCH") return <ResearchView output={stage.output as ResearchOutput} />;
  if (stage.stage === "OUTLINE") return <OutlineView output={stage.output as OutlineOutput} />;
  if (stage.stage === "DRAFT") return <DraftView output={stage.output as DraftOutput} />;
  if (stage.stage === "EDITORIAL") return <EditorialView output={stage.output as EditorialOutput} />;
  return <RepurposeView output={stage.output as RepurposeOutput} />;
}

function ResearchView({ output }: { output: ResearchOutput }) {
  return (
    <div className="prose">
      <p>{output.summary}</p>
      {output.claims.map((claim) => (
        <article className="claim" key={claim.id}>
          <header className="block"><span className="chip" data-kind={claim.verification}>{claim.verification.replaceAll("_", " ")}</span><span className="chip" data-kind={claim.provenance}>{claim.provenance.replaceAll("_", " ")}</span></header>
          <p>{claim.text}</p>
          {claim.sourceUrl ? <p className="source-url">{claim.sourceUrl}</p> : null}
        </article>
      ))}
    </div>
  );
}

function OutlineView({ output }: { output: OutlineOutput }) {
  const words = output.sections.reduce((sum, section) => sum + section.wordAllocation, 0);
  return (
    <div className="prose">
      <h3>{output.workingTitle}</h3>
      <p>{output.thesis}</p>
      <p className="fine">{output.audience} · about {words} words</p>
      {output.sections.map((section) => (
        <article key={section.id}>
          <h3>{section.heading}</h3>
          <p>{section.purpose}</p>
          <ul>{section.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
          <p className="fine">{section.wordAllocation} words · {section.evidenceRefs.length ? section.evidenceRefs.join(" · ") : "No evidence attached"}</p>
        </article>
      ))}
    </div>
  );
}

function DraftView({ output }: { output: DraftOutput }) {
  return (
    <div className="article prose">
      <h3>{output.title}</h3>
      {output.blocks.map((block) => (
        <div className="block" key={block.id}>
          <header><span className="chip" data-kind={block.provenance}>{block.provenance.replaceAll("_", " ")}</span></header>
          {block.kind === "heading" ? <h3>{block.text}</h3> : <p>{block.text}</p>}
        </div>
      ))}
      <p className="fine">SEO: {output.seo.title} · /{output.seo.slug}</p>
      {output.cta ? <p className="fine">CTA: {output.cta}</p> : null}
    </div>
  );
}

function EditorialView({ output }: { output: EditorialOutput }) {
  return (
    <div>
      <p><strong>{output.verdict.replaceAll("_", " ")}</strong></p>
      {output.findings.length === 0 ? <p>No findings.</p> : output.findings.map((finding) => (
        <article className="finding" key={finding.id}>
          <strong>{finding.severity} · {finding.category.replaceAll("_", " ")}</strong>
          <p>{finding.summary}</p>
          <p className="fine">“{finding.affectedExcerpt}”</p>
          <p>{finding.suggestion}</p>
          {finding.verificationFlag ? <span className="chip" data-kind={finding.verificationFlag}>{finding.verificationFlag.replaceAll("_", " ")}</span> : null}
        </article>
      ))}
    </div>
  );
}

function RepurposeView({ output }: { output: RepurposeOutput }) {
  return (
    <div className="copy">
      {(["linkedin", "linkedinShort", "x", "newsletterIntro", "summary"] as const).map((key) => (
        <article key={key}>
          <header className="block"><strong>{key}</strong><span className="chip" data-kind={output[key].provenance}>{output[key].provenance.replaceAll("_", " ")}</span></header>
          <p className="fine">{output[key].purpose}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{output[key].body}</p>
        </article>
      ))}
    </div>
  );
}

function Editor({ stage, value, onChange }: { stage: StageView; value: unknown; onChange: (value: unknown) => void }) {
  const data = (value ?? {}) as Record<string, unknown>;
  if (stage.stage === "RESEARCH") {
    const claims = (data.claims as Array<{ id: string; text: string }> | undefined) ?? [];
    return (
      <div className="editor">
        <label>Summary<textarea value={String(data.summary ?? "")} onChange={(event) => onChange({ ...data, summary: event.target.value })} /></label>
        {claims.map((claim, index) => (
          <label key={claim.id}>Claim {index + 1}<textarea value={claim.text} onChange={(event) => onChange({ ...data, claims: claims.map((item) => item.id === claim.id ? { ...item, text: event.target.value } : item) })} /></label>
        ))}
      </div>
    );
  }
  if (stage.stage === "OUTLINE") {
    const sections = (data.sections as Array<{ id: string; heading: string; purpose: string; keyPoints: string[]; wordAllocation: number }> | undefined) ?? [];
    return (
      <div className="editor">
        <label>Working title<input value={String(data.workingTitle ?? "")} onChange={(event) => onChange({ ...data, workingTitle: event.target.value })} /></label>
        <label>Thesis<textarea value={String(data.thesis ?? "")} onChange={(event) => onChange({ ...data, thesis: event.target.value })} /></label>
        <label>Audience<input value={String(data.audience ?? "")} onChange={(event) => onChange({ ...data, audience: event.target.value })} /></label>
        {sections.map((section) => (
          <div key={section.id}>
            <label>Heading<input value={section.heading} onChange={(event) => updateSection(sections, section.id, { heading: event.target.value }, data, onChange)} /></label>
            <label>Purpose<textarea value={section.purpose} onChange={(event) => updateSection(sections, section.id, { purpose: event.target.value }, data, onChange)} /></label>
            <label>Key points, one per line<textarea value={section.keyPoints.join("\n")} onChange={(event) => updateSection(sections, section.id, { keyPoints: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) }, data, onChange)} /></label>
          </div>
        ))}
      </div>
    );
  }
  if (stage.stage === "DRAFT") {
    const seo = (data.seo as DraftOutput["seo"]) ?? { title: "", description: "", keywords: [], slug: "" };
    return (
      <div className="editor">
        <p className="fine">You are editing generated copy. Saving marks the article as human-edited and clears the old provenance tags.</p>
        <label>Title<input value={String(data.title ?? "")} onChange={(event) => onChange({ ...data, title: event.target.value })} /></label>
        <label>Article<textarea style={{ minHeight: 280 }} value={String(data.article ?? "")} onChange={(event) => onChange({ ...data, article: event.target.value })} /></label>
        <label>Call to action<input value={String(data.cta ?? "")} onChange={(event) => onChange({ ...data, cta: event.target.value })} /></label>
        <label>SEO title<input maxLength={70} value={seo.title} onChange={(event) => onChange({ ...data, seo: { ...seo, title: event.target.value } })} /></label>
        <label>Meta description<textarea maxLength={180} value={seo.description} onChange={(event) => onChange({ ...data, seo: { ...seo, description: event.target.value } })} /></label>
        <label>Keywords<input value={seo.keywords.join(", ")} onChange={(event) => onChange({ ...data, seo: { ...seo, keywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /></label>
        <label>Slug<input value={seo.slug} onChange={(event) => onChange({ ...data, seo: { ...seo, slug: event.target.value } })} /></label>
      </div>
    );
  }
  if (stage.stage === "REPURPOSE") {
    return (
      <div className="editor">
        {(["linkedin", "linkedinShort", "x", "newsletterIntro", "summary"] as const).map((key) => (
          <label key={key}>{key}<textarea value={String(data[key] ?? "")} onChange={(event) => onChange({ ...data, [key]: event.target.value })} /></label>
        ))}
      </div>
    );
  }
  return <p>This stage is not edited in place.</p>;
}

function updateSection(
  sections: Array<{ id: string; heading: string; purpose: string; keyPoints: string[]; wordAllocation: number }>,
  id: string,
  patch: Record<string, unknown>,
  data: Record<string, unknown>,
  onChange: (value: unknown) => void,
) {
  onChange({ ...data, sections: sections.map((section) => (section.id === id ? { ...section, ...patch } : section)) });
}

function editorSeed(stage: StageView): unknown {
  if (!stage.output) return {};
  if (stage.stage === "RESEARCH") {
    const output = stage.output as ResearchOutput;
    return { summary: output.summary, claims: output.claims.map((claim) => ({ id: claim.id, text: claim.text })) };
  }
  if (stage.stage === "OUTLINE") {
    const output = stage.output as OutlineOutput;
    return {
      workingTitle: output.workingTitle,
      thesis: output.thesis,
      audience: output.audience,
      sections: output.sections.map((section) => ({
        id: section.id,
        heading: section.heading,
        purpose: section.purpose,
        keyPoints: section.keyPoints,
        wordAllocation: section.wordAllocation,
      })),
    };
  }
  if (stage.stage === "DRAFT") {
    const output = stage.output as DraftOutput;
    return { title: output.title, cta: output.cta ?? "", article: stage.article ?? "", seo: output.seo };
  }
  if (stage.stage === "REPURPOSE") {
    const output = stage.output as RepurposeOutput;
    return {
      linkedin: output.linkedin.body,
      linkedinShort: output.linkedinShort.body,
      x: output.x.body,
      newsletterIntro: output.newsletterIntro.body,
      summary: output.summary.body,
    };
  }
  return {};
}

function Activity({ run }: { run: RunView }) {
  return (
    <ol className="feed" aria-live="polite">
      {run.events.length === 0 ? <li><span /><span>No events yet.</span></li> : run.events.map((event) => (
        <li key={event.id}><time dateTime={event.createdAt}>{formatClock(event.createdAt)}</time><span>{event.message}</span></li>
      ))}
    </ol>
  );
}

function Sources({ run }: { run: RunView }) {
  const research = run.stages.find((stage) => stage.stage === "RESEARCH");
  if (!research || research.sources.length === 0) return <p className="fine">Sources appear here after research finishes. Only retrieved sources are listed.</p>;
  return (
    <div>
      {research.stale ? <p className="fine">These sources belong to a stale research version.</p> : null}
      {research.sources.map((source) => (
        <article className="claim" key={source.id}>
          <strong>{source.title}</strong>
          <p className="fine">{source.provider === "demo-corpus" ? "Demo corpus" : source.publisher} · retrieved {formatClock(source.retrievedAt)}</p>
          <p>{source.excerpt}</p>
          <p className="source-url">{source.url}</p>
        </article>
      ))}
    </div>
  );
}

function Checks({ run }: { run: RunView }) {
  const research = run.stages.find((stage) => stage.stage === "RESEARCH");
  const editorial = run.stages.find((stage) => stage.stage === "EDITORIAL");
  const findings = (editorial?.output as EditorialOutput | null)?.findings ?? [];
  return (
    <div>
      <h2>Verification</h2>
      {research?.claims.filter((claim) => claim.verification !== "SOURCE_GROUNDED").map((claim) => (
        <article className="claim" key={claim.id}>
          <span className="chip" data-kind={claim.verification}>{claim.verification.replaceAll("_", " ")}</span>
          <p>{claim.text}</p>
        </article>
      ))}
      {findings.map((finding) => (
        <article className="finding" key={finding.id}>
          <strong>{finding.severity}</strong>
          <p>{finding.summary}</p>
          <p className="fine">{finding.suggestion}</p>
        </article>
      ))}
      <h2>Human edits</h2>
      {run.edits.length === 0 ? <p className="fine">No human edits yet.</p> : run.edits.map((edit) => (
        <article className="claim" key={edit.id}>
          <p className="fine">{edit.stage} v{edit.version} · {edit.fieldPath}</p>
          <p>{edit.afterText}</p>
        </article>
      ))}
    </div>
  );
}

function statusLabel(stage: StageView): string {
  if (stage.status === "AWAITING_REVIEW") return "Needs approval";
  if (stage.status === "RUNNING") return "Running";
  if (stage.status === "STALE") return "Stale";
  if (stage.status === "WAITING") return "Waiting";
  return stage.status.charAt(0) + stage.status.slice(1).toLowerCase();
}

function stageSummary(stage: StageView): string {
  if (stage.stage === "RESEARCH" && stage.sources.length) return `${stage.sources.length} sources · ${stage.claims.length} claims`;
  if (stage.stage === "EDITORIAL" && stage.output && "findings" in stage.output) return `${stage.output.findings.length} findings`;
  if (stage.attemptCount > 0 && (stage.status === "FAILED" || stage.status === "RUNNING")) return `Attempt ${stage.attemptCount} of ${stage.maxRetries}`;
  if (stage.humanEdited) return "Human edited";
  return stage.status === "WAITING" ? "Not started" : stage.purpose;
}

function labelOf(run: RunView, stage: StageName): string {
  return run.stages.find((item) => item.stage === stage)?.label ?? stage;
}

function newKey(): string {
  return crypto.randomUUID();
}
