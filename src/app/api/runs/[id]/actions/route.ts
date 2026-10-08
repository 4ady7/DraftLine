import { actionSchema } from "@/domain/schemas";
import { ownerFromRequest } from "@/server/auth";
import { handle, idempotencyKey, json, readJson } from "@/server/http";
import {
  approve,
  cancel,
  editStage,
  getRun,
  kick,
  regenerate,
  reject,
  retry,
  simulate,
  startRun,
} from "@/server/workflow/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const owner = ownerFromRequest(req);
    const body = await readJson(req, actionSchema);
    if (body.action === "kick") {
      await kick(owner, id);
      return json({ replayed: false, run: await getRun(owner, id) });
    }
    const key = idempotencyKey(req);
    if (body.action === "start") await startRun(owner, id, key);
    if (body.action === "approve") await approve(owner, id, key, body);
    if (body.action === "reject") await reject(owner, id, key, body);
    if (body.action === "edit") {
      await editStage(owner, id, key, { stage: body.stage, expectedRevision: body.expectedRevision, content: body.content ?? null });
    }
    if (body.action === "regenerate") await regenerate(owner, id, key, body.stage);
    if (body.action === "retry") await retry(owner, id, key);
    if (body.action === "cancel") await cancel(owner, id, key);
    if (body.action === "simulate") await simulate(owner, id, key, body);
    return json({ run: await getRun(owner, id) });
  });
}
