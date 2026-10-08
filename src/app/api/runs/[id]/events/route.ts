import { ownerFromRequest } from "@/server/auth";
import { getDb } from "@/server/db";
import { handle } from "@/server/http";
import { subscribe } from "@/server/events";
import { getRun } from "@/server/workflow/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    await getRun(ownerFromRequest(req), id);
    const url = new URL(req.url);
    let cursor = Number(url.searchParams.get("cursor") ?? req.headers.get("last-event-id") ?? 0);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: { id: number; type: string; message: string; createdAt: Date }) => {
          const payload = JSON.stringify({
            id: event.id,
            type: event.type,
            message: event.message,
            createdAt: event.createdAt.toISOString(),
          });
          controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${payload}\n\n`));
        };

        const flush = async () => {
          if (closed) return;
          const events = await getDb().workflowEvent.findMany({
            where: { runId: id, id: { gt: cursor } },
            orderBy: { id: "asc" },
            take: 100,
          });
          for (const event of events) {
            cursor = event.id;
            send(event);
          }
        };

        void flush();
        const unsubscribe = subscribe(id, () => {
          void flush();
        });
        const timer = setInterval(() => {
          if (closed) return;
          controller.enqueue(encoder.encode(`: ping\n\n`));
          void flush();
        }, 2000);
        const abort = () => {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        req.signal.addEventListener("abort", abort);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
