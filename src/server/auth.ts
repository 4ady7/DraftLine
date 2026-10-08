import { AppError } from "@/server/errors";

const OWNER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ownerFromRequest(req: Request): string {
  const header = req.headers.get("x-dl-owner");
  const cookie = readCookie(req, "dl_owner");
  const key = header || cookie;
  if (!key || !OWNER_RE.test(key)) {
    throw new AppError("This browser does not have a Draftline session yet. Refresh the page.", "UNAUTHORIZED", 401);
  }
  return key;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function faultSimulationEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DRAFTLINE_FAULTS === "1";
}

export function liveAiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

export function liveSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}
