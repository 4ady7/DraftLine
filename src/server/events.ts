import { getDb } from "@/server/db";

type Listener = (event: { id: number }) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(runId: string, listener: Listener): () => void {
  const set = listeners.get(runId) ?? new Set();
  set.add(listener);
  listeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(runId);
  };
}

function notify(runId: string, id: number) {
  for (const listener of listeners.get(runId) ?? []) listener({ id });
}

export async function emitEvent(runId: string, type: string, message: string, payload?: unknown): Promise<void> {
  try {
    const row = await getDb().workflowEvent.create({
      data: {
        runId,
        type,
        message,
        payloadJson: payload === undefined ? null : JSON.stringify(payload).slice(0, 4000),
      },
    });
    notify(runId, row.id);
  } catch {
    console.error("event persist failed", { runId, type });
  }
}
