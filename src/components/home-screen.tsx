"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO_BRIEFS } from "@/demo/briefs";

export function HomeScreen() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState({
    projectName: "",
    title: "",
    audience: "",
    contentGoal: "",
    rawBrief: "",
    brandName: "",
    tone: "",
    wordsToAvoid: "",
    styleGuidance: "",
    exampleCopy: "",
  });

  async function startDemo(demoId: string) {
    await create({ kind: "demo", demoId, mode: "mock" as const }, demoId);
  }

  async function startCustom(event: React.FormEvent) {
    event.preventDefault();
    const brand = custom.brandName.trim()
      ? {
          brandName: custom.brandName.trim(),
          tone: custom.tone.trim() || "Direct and specific.",
          audience: custom.audience.trim(),
          preferredLanguage: "en",
          wordsToUse: [],
          wordsToAvoid: splitList(custom.wordsToAvoid),
          styleGuidance: custom.styleGuidance.trim() || "Prefer concrete sentences over slogans.",
          exampleCopy: custom.exampleCopy.trim() || custom.contentGoal.trim(),
        }
      : undefined;
    await create(
      {
        kind: "custom",
        mode: "mock",
        projectName: custom.projectName,
        title: custom.title,
        audience: custom.audience,
        contentGoal: custom.contentGoal,
        rawBrief: custom.rawBrief,
        brand,
      },
      "custom",
    );
  }

  async function create(body: unknown, key: string) {
    setPending(key);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.message ?? "The brief could not be saved.");
        return;
      }
      router.push(`/runs/${data.runId}`);
    } catch {
      setError("The network request failed. Nothing was started.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="shell" id="main">
      <p className="eyebrow">Human in the loop</p>
      <h1>Turn a rough brief into a reviewable first draft, without losing editorial control.</h1>
      <p className="lede">
        Draftline runs research, outline, draft, editorial check, and repurposing as a visible workflow. The model does the mechanical first pass. You approve, edit, or send a stage back. Nothing advances while a checkpoint is open.
      </p>
      {error ? <div className="banner" data-kind="error"><p>{error}</p></div> : null}
      <div className="home-grid">
        <section>
          <h2 className="section-label">Demo briefs</h2>
          <div className="card-list">
            {DEMO_BRIEFS.map((brief) => (
              <article className="brief-card" key={brief.id}>
                <div className="kicker">{brief.category}</div>
                <h3>{brief.title}</h3>
                <p>{brief.summary}</p>
                <div className="card-actions">
                  <span className="fine">{brief.audience}</span>
                  <button className="btn btn-primary" type="button" disabled={pending !== null} onClick={() => startDemo(brief.id)}>
                    {pending === brief.id ? "Saving brief…" : "Use this brief"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Your own brief</h2>
          <p className="fine">Demo mode will not invent outside sources for a custom topic. It will say so, and mark the brief itself as unverified.</p>
          <form className="form" onSubmit={startCustom}>
            <label>Project name<input required maxLength={120} value={custom.projectName} onChange={(event) => setCustom({ ...custom, projectName: event.target.value })} /></label>
            <label>Working title<input required maxLength={200} value={custom.title} onChange={(event) => setCustom({ ...custom, title: event.target.value })} /></label>
            <label>Audience<input required maxLength={300} value={custom.audience} onChange={(event) => setCustom({ ...custom, audience: event.target.value })} /></label>
            <label>Content goal<input required maxLength={500} value={custom.contentGoal} onChange={(event) => setCustom({ ...custom, contentGoal: event.target.value })} /></label>
            <label>Brief<textarea required minLength={20} maxLength={8000} value={custom.rawBrief} onChange={(event) => setCustom({ ...custom, rawBrief: event.target.value })} /></label>
            <label>Brand name, if you have one<input maxLength={120} value={custom.brandName} onChange={(event) => setCustom({ ...custom, brandName: event.target.value })} /></label>
            <label>Tone<input maxLength={300} value={custom.tone} onChange={(event) => setCustom({ ...custom, tone: event.target.value })} /></label>
            <label>Words to avoid<input maxLength={200} placeholder="synergy, unlock" value={custom.wordsToAvoid} onChange={(event) => setCustom({ ...custom, wordsToAvoid: event.target.value })} /></label>
            <label>Style guidance<textarea maxLength={1000} value={custom.styleGuidance} onChange={(event) => setCustom({ ...custom, styleGuidance: event.target.value })} /></label>
            <label>Example copy<textarea maxLength={600} value={custom.exampleCopy} onChange={(event) => setCustom({ ...custom, exampleCopy: event.target.value })} /></label>
            <button className="btn btn-primary" type="submit" disabled={pending !== null}>{pending === "custom" ? "Saving…" : "Create run"}</button>
          </form>
        </section>
      </div>
    </main>
  );
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}
