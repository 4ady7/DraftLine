import { ZodError, type ZodType } from "zod";
import { InvalidTransitionError } from "@/domain/stages";
import { AppError } from "@/server/errors";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return json({ error: { code: "INVALID_TRANSITION", message: error.message, details: null } }, 409);
    }
    if (error instanceof ZodError) {
      return json(
        {
          error: {
            code: "VALIDATION",
            message: "Request is invalid.",
            details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
          },
        },
        400,
      );
    }
    if (error instanceof AppError) {
      return json({ error: { code: error.code, message: error.message, details: error.details ?? null } }, error.status);
    }
    console.error("request failed");
    return json({ error: { code: "INTERNAL", message: "The server hit an unexpected error.", details: null } }, 500);
  }
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const text = await req.text();
  if (text.length > 100_000) {
    throw new AppError("Request body is too large.", "VALIDATION", 413);
  }
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError("Request body must be JSON.", "VALIDATION", 400);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError("Request is invalid.", "VALIDATION", 400, {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return parsed.data;
}

export function idempotencyKey(req: Request): string {
  const key = req.headers.get("x-idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    throw new AppError("Send an idempotency key between 8 and 80 characters.", "VALIDATION", 400);
  }
  return key;
}
