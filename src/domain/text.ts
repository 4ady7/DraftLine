import type { DraftOutput, Provenance } from "@/domain/schemas";

export function blocksToMarkdown(blocks: DraftOutput["blocks"]): string {
  return blocks
    .map((block) => (block.kind === "heading" ? `## ${block.text}` : block.text))
    .join("\n\n");
}

export function markdownToBlocks(markdown: string): DraftOutput["blocks"] {
  const chunks = markdown
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.map((chunk, index) => {
    if (chunk.startsWith("## ")) {
      return {
        id: `edit-${index + 1}`,
        kind: "heading" as const,
        text: chunk.replace(/^##\s+/, "").trim(),
        provenance: "HUMAN_EDITED" as Provenance,
        sourceUrls: [],
      };
    }
    return {
      id: `edit-${index + 1}`,
      kind: "paragraph" as const,
      text: chunk,
      provenance: "HUMAN_EDITED" as Provenance,
      sourceUrls: [],
    };
  });
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "draft";
}

export function trimAtWord(input: string, max: number): string {
  const clean = input.trim();
  if (clean.length <= max) return clean;
  const flat = clean.replace(/\s+/g, " ");
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

export function isPublicHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function overlapsExcerpt(claim: string, excerpt: string): boolean {
  const tokens = claim
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);
  if (tokens.length === 0) return excerpt.toLowerCase().includes(claim.toLowerCase());
  const hay = excerpt.toLowerCase();
  const hits = tokens.filter((token) => hay.includes(token));
  return hits.length >= Math.min(4, tokens.length) && hits.length / tokens.length >= 0.5;
}

export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds}s`;
}
