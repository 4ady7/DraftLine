import type { ZodType } from "zod";
import { editorialOutputSchema, outlineOutputSchema, repurposePackageSchema, researchModelSchema } from "@/domain/schemas";
import type { AIProvider, CompletionArgs } from "@/server/ai/provider";
import { synthesizeDraft, synthesizeEditorial, synthesizeOutline, synthesizeRepurpose, synthesizeResearch } from "@/server/ai/synthesize";
import { MalformedModelOutputError } from "@/server/errors";

function section(prompt: string, name: string): unknown {
  const start = prompt.indexOf(`${name}_JSON:`);
  if (start < 0) throw new MalformedModelOutputError(`Mock provider could not find ${name}_JSON in the prompt.`);
  const from = prompt.indexOf("\n", start);
  const endMarker = `\nEND_${name}`;
  const end = prompt.indexOf(endMarker, from);
  if (from < 0 || end < 0) throw new MalformedModelOutputError(`Mock provider could not read ${name}_JSON.`);
  try {
    return JSON.parse(prompt.slice(from, end));
  } catch {
    throw new MalformedModelOutputError(`Mock provider received invalid ${name}_JSON.`);
  }
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async completeStructured<T>(args: CompletionArgs<T>): Promise<T> {
    const value = synthesize(args.schemaName, args.prompt);
    const parsed = args.schema.safeParse(value);
    if (!parsed.success) {
      throw new MalformedModelOutputError(parsed.error.issues[0]?.message ?? "Mock output failed validation.");
    }
    return parsed.data;
  }
}

function synthesize(schemaName: string, prompt: string): unknown {
  switch (schemaName) {
    case "ResearchOutput":
      return researchModelSchema.parse(synthesizeResearch(section(prompt, "SOURCES") as never, section(prompt, "BRIEF") as never));
    case "OutlineOutput":
      return outlineOutputSchema.parse(
        synthesizeOutline({
          brief: section(prompt, "BRIEF") as never,
          research: section(prompt, "RESEARCH") as never,
        }),
      );
    case "DraftOutput":
      return synthesizeDraft({
        brief: section(prompt, "BRIEF") as never,
        research: section(prompt, "RESEARCH") as never,
        outline: section(prompt, "OUTLINE") as never,
        brand: section(prompt, "BRAND") as never,
      });
    case "EditorialOutput":
      return editorialOutputSchema.parse({ verdict: "PASS", findings: synthesizeEditorial() });
    case "RepurposeOutput":
      return repurposePackageSchema.parse(
        synthesizeRepurpose({
          brief: section(prompt, "BRIEF") as never,
          draft: section(prompt, "DRAFT") as never,
          editorial: section(prompt, "EDITORIAL") as never,
          brand: section(prompt, "BRAND") as never,
        }),
      );
    default:
      throw new MalformedModelOutputError(`Unknown schema ${schemaName}.`);
  }
}

export function schemaForName(name: string): ZodType | null {
  if (name === "ResearchOutput") return researchModelSchema;
  if (name === "OutlineOutput") return outlineOutputSchema;
  if (name === "EditorialOutput") return editorialOutputSchema;
  if (name === "RepurposeOutput") return repurposePackageSchema;
  return null;
}
