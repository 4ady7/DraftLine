export const DEMO_BRIEFS = [
  {
    id: "northwind-close",
    category: "B2B SaaS",
    projectName: "Northwind Close",
    title: "Why spreadsheet close breaks past the first real growth spurt",
    audience: "VP Finance and controllers at mid-market B2B companies",
    contentGoal: "Help finance leaders recognise the operational cost of a batch close and request a working session.",
    summary:
      "A blog briefing on month-end as a queue, what a late close does to the operating meeting, and the sign-off a platform cannot replace.",
  },
  {
    id: "hale-retainer",
    category: "Professional services",
    projectName: "Hale & Mercer",
    title: "How to explain an AI governance retainer to a COO",
    audience: "COOs and general counsels at regulated companies",
    contentGoal: "Equip a buyer to scope a first 90-day engagement and to see what the firm will not pretend to own.",
    summary:
      "An advisory note on scope, refusals, decision rights, and how a COO can tell whether the firm is actually accountable.",
  },
  {
    id: "relay-agents",
    category: "AI and engineering",
    projectName: "Relay",
    title: "What to settle before coding agents touch production",
    audience: "VP Engineering and platform leads",
    contentGoal: "Give a VP a briefing they can forward to security and platform before agents open pull requests.",
    summary:
      "A technical briefing on access boundaries, review load, autonomous merges, and the audit trail a security lead will ask for.",
  },
] as const;

export type DemoId = (typeof DEMO_BRIEFS)[number]["id"];

export function isDemoId(value: string): value is DemoId {
  return DEMO_BRIEFS.some((brief) => brief.id === value);
}
