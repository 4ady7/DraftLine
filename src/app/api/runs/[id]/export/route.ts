import { ownerFromRequest } from "@/server/auth";
import { buildExport, toMarkdown } from "@/server/export";
import { handle } from "@/server/http";
import { getRun } from "@/server/workflow/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params;
    const format = new URL(req.url).searchParams.get("format");
    if (format !== "markdown" && format !== "json") {
      return Response.json({ error: { code: "VALIDATION", message: "Format must be markdown or json.", details: null } }, { status: 400 });
    }
    const run = await getRun(ownerFromRequest(req), id);
    const doc = buildExport(run);
    if (!doc.article && !doc.research && !doc.outline && !doc.repurpose) {
      return Response.json(
        { error: { code: "NOTHING_TO_EXPORT", message: "Nothing approved is ready to export yet.", details: { omitted: doc.omitted } } },
        { status: 409 },
      );
    }
    if (format === "json") {
      return new Response(JSON.stringify(doc, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="draftline-${id}.json"`,
        },
      });
    }
    return new Response(toMarkdown(doc), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="draftline-${id}.md"`,
      },
    });
  });
}
