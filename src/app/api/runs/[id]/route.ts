import { ownerFromRequest } from "@/server/auth";
import { handle, json } from "@/server/http";
import { getRun } from "@/server/workflow/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const run = await getRun(ownerFromRequest(req), id);
    return json({ run });
  });
}
