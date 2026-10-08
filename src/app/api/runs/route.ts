import { createRunSchema } from "@/domain/schemas";
import { ownerFromRequest } from "@/server/auth";
import { handle, idempotencyKey, json, readJson } from "@/server/http";
import { createRun } from "@/server/workflow/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const owner = ownerFromRequest(req);
    const key = idempotencyKey(req);
    const input = await readJson(req, createRunSchema);
    const created = await createRun(owner, input, key);
    return json(created, created.replayed ? 200 : 201);
  });
}
