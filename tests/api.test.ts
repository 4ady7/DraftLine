import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/runs/route";
import { GET as getRoute } from "@/app/api/runs/[id]/route";
import { POST as actionRoute } from "@/app/api/runs/[id]/actions/route";

const owner = randomUUID();

function request(url: string, body?: unknown, key = randomUUID()) {
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-dl-owner": owner,
      "x-idempotency-key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("run API", () => {
  it("rejects an invalid brief and an unknown run", async () => {
    const invalid = await createRoute(request("http://localhost/api/runs", { kind: "demo", demoId: "nope" }));
    expect(invalid.status).toBe(400);
    const missing = await getRoute(request("http://localhost/api/runs/not-a-run"), { params: Promise.resolve({ id: "not-a-run" }) });
    expect(missing.status).toBe(404);
  });

  it("creates a run and ignores a duplicate start", async () => {
    const created = await createRoute(request("http://localhost/api/runs", { kind: "demo", demoId: "relay-agents", mode: "mock" }));
    expect(created.status).toBe(201);
    const { runId } = await created.json();
    const key = randomUUID();
    const context = { params: Promise.resolve({ id: runId }) };
    const first = await actionRoute(request(`http://localhost/api/runs/${runId}/actions`, { action: "start" }, key), context);
    expect(first.status).toBe(200);
    const second = await actionRoute(request(`http://localhost/api/runs/${runId}/actions`, { action: "start" }, key), context);
    expect(second.status).toBe(200);
    let state = "";
    for (let attempt = 0; attempt < 40 && state !== "RESEARCH_REVIEW" && state !== "FAILED"; attempt += 1) {
      const current = await getRoute(request(`http://localhost/api/runs/${runId}`), context);
      const body = await current.json();
      state = body.run.state;
      if (state !== "RESEARCH_REVIEW" && state !== "FAILED") await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(state).toBe("RESEARCH_REVIEW");
    const outsider = await getRoute(
      new Request(`http://localhost/api/runs/${runId}`, { headers: { "x-dl-owner": randomUUID() } }),
      context,
    );
    expect(outsider.status).toBe(404);
  });
});
