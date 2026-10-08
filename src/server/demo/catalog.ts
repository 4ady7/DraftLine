import type { BrandProfileInput, Verification } from "@/domain/schemas";
import type { DemoId } from "@/demo/briefs";

export type CorpusSource = {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  relevance: string;
  claim: string;
  verification: Verification;
};

export type OutlineBlueprint = {
  workingTitle: string;
  thesis: string;
  sections: Array<{
    id: string;
    heading: string;
    purpose: string;
    bridge: string;
    evidenceSourceIds: string[];
    wordAllocation: number;
  }>;
};

export type DemoPackage = {
  id: DemoId;
  category: string;
  projectName: string;
  title: string;
  rawBrief: string;
  audience: string;
  contentGoal: string;
  brand: BrandProfileInput;
  corpus: CorpusSource[];
  outline: OutlineBlueprint;
};

const northwind: DemoPackage = {
  id: "northwind-close",
  category: "northwind-close",
  projectName: "Northwind Close",
  title: "Why spreadsheet close breaks past the first real growth spurt",
  audience: "VP Finance and controllers at mid-market B2B companies",
  contentGoal: "Help finance leaders recognise the operational cost of a batch close and request a working session.",
  rawBrief:
    "Explain why spreadsheet-based month-end close breaks down once a B2B company is past its first real growth spurt, and how a continuous close platform changes the operating cadence. This is a Northwind blog post, not a product sheet. Name the queue: reconciliations, flux comments, and journal review waiting on the same people. Connect a late close to the operating meeting. Include the cited 8.5-day median only as a figure that still needs a primary source. Make the product point a cadence change, not a promise of ROI. End on the boundary: judgmental entries still need a named human sign-off. Avoid hype. Do not invent a customer logo or a savings percentage.",
  brand: {
    brandName: "Northwind",
    tone: "Precise, calm, and written for operators. Short sentences. No cheerleading.",
    audience: "Controllers and VPs of finance who have lived through a late close.",
    preferredLanguage: "en",
    wordsToUse: ["close", "cadence", "sign-off", "evidence", "controller"],
    wordsToAvoid: ["synergy", "revolutionize", "unlock", "seamless", "10x"],
    styleGuidance: "Write as a briefing a controller could forward. Prefer concrete operating detail over product adjectives.",
    exampleCopy: "The close did not slip because the team lacked effort. It slipped because the evidence arrived in one queue.",
  },
  corpus: [
    {
      id: "close-window",
      url: "https://demo.draftline.local/corpus/northwind/close-queue",
      title: "Batch close slips when review shares one queue",
      excerpt:
        "Finance teams running close in spreadsheets start missing the internal reporting date once several entities share one workbook trail. The pattern is not a talent problem. It is a queue: reconciliations, flux comments, and journal review wait on the same few people, and the wait only becomes visible at the end of the month.",
      relevance: "Names the operating failure the brief asks for, without turning it into a talent critique.",
      claim: "Spreadsheet close turns reconciliation and review into a queue that surfaces slippage only at month end.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "calendar-cost",
      url: "https://demo.draftline.local/corpus/northwind/calendar-cost",
      title: "What a day-10 close does to the operating meeting",
      excerpt:
        "A close that finishes on business day 10 means operating reviews happen on stale numbers, and the leadership meeting either slips or proceeds without a reliable cash and margin picture. Controllers in these notes describe the cost as delayed decisions, not as overtime.",
      relevance: "Connects close timing to the quality of the operating review.",
      claim: "A close that lands on business day 10 pushes operating reviews onto stale numbers.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "survey-stat",
      url: "https://demo.draftline.local/corpus/northwind/cited-median",
      title: "Cited survey figure for mid-market close length",
      excerpt:
        "A 2024 operating survey cited in this note puts the median mid-market close at 8.5 business days. The note does not include the survey microdata or the sample frame, and the figure should be checked against a primary source before publication.",
      relevance: "A numeric claim the editorial check should hold back until a human verifies it.",
      claim: "A 2024 operating survey puts the median mid-market close at 8.5 business days.",
      verification: "NEEDS_CURRENT_DATA",
    },
    {
      id: "cadence",
      url: "https://demo.draftline.local/corpus/northwind/continuous-cadence",
      title: "Continuous close changes when evidence is gathered",
      excerpt:
        "Teams that move reconciliations into the week stop treating day one of close as the moment evidence is gathered. The close becomes a confirmation step. The same note warns that the tool does not remove the need for a human to sign off on judgmental entries.",
      relevance: "Defines the product idea as a change in when work happens.",
      claim: "Teams that move reconciliations into the week stop treating day one of close as the moment evidence is gathered. The close becomes a confirmation step.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "signoff",
      url: "https://demo.draftline.local/corpus/northwind/named-signoff",
      title: "Judgment entries still need a named owner",
      excerpt:
        "Accruals, revenue cut-off, and one-off reserves remain judgment calls. A platform can show who prepared the entry and which evidence is attached. It cannot decide the accounting. The sign-off has to stay with a named controller.",
      relevance: "Sets the boundary the brand wants the article to keep.",
      claim: "A platform can show who prepared the entry and which evidence is attached. The sign-off has to stay with a named controller.",
      verification: "SOURCE_GROUNDED",
    },
  ],
  outline: {
    workingTitle: "The close is a queue. Software does not empty it by itself.",
    thesis:
      "Month-end breaks when evidence, review, and sign-off share one end-of-month queue. A continuous close platform helps only when preparation moves into the month and judgment stays with a named owner.",
    sections: [
      {
        id: "queue",
        heading: "The close is a queue",
        purpose: "Name the operating failure without blaming the team.",
        bridge: "Month-end slips when reconciliation, flux review, and journal approval all wait on the same people.",
        evidenceSourceIds: ["close-window"],
        wordAllocation: 180,
      },
      {
        id: "calendar",
        heading: "What a late close does to the operating meeting",
        purpose: "Connect close timing to the quality of decisions, not to hours worked.",
        bridge: "The cost shows up as a leadership meeting that is either late or confident about stale numbers.",
        evidenceSourceIds: ["calendar-cost"],
        wordAllocation: 160,
      },
      {
        id: "figure",
        heading: "The 8.5-day figure is not ready to publish",
        purpose: "Show restraint around a cited statistic that lacks a primary source.",
        bridge: "The corpus contains a median close length, and it should not ship until someone checks the underlying survey.",
        evidenceSourceIds: ["survey-stat"],
        wordAllocation: 140,
      },
      {
        id: "cadence",
        heading: "Continuous close is a cadence change",
        purpose: "Explain the product as a change in when evidence is prepared.",
        bridge: "The platform matters if preparation moves into the month and day one becomes confirmation.",
        evidenceSourceIds: ["cadence"],
        wordAllocation: 180,
      },
      {
        id: "signoff",
        heading: "Judgment stays with a named owner",
        purpose: "Draw the boundary between evidence display and accounting judgment.",
        bridge: "Software can show who prepared an entry and which evidence is attached. It does not make the accounting judgment.",
        evidenceSourceIds: ["signoff"],
        wordAllocation: 160,
      },
    ],
  },
};

const hale: DemoPackage = {
  id: "hale-retainer",
  category: "hale-retainer",
  projectName: "Hale & Mercer",
  title: "How to explain an AI governance retainer to a COO",
  audience: "COOs and general counsels at regulated companies",
  contentGoal: "Equip a buyer to scope a first 90-day engagement and to see what the firm will not pretend to own.",
  rawBrief:
    "Write a plainspoken advisory piece for a COO who has been asked to buy an AI governance retainer. Explain what Hale & Mercer actually does in the first 90 days: model and use-case inventory, decision rights, vendor questions, and an incident drill. Be explicit about refusals: the retainer is not a certification, not a promise that the company is compliant, and not outside counsel unless that is separately engaged. Mention the often-quoted board-policy statistic only as a figure that needs a primary source. End with how the COO can tell the firm is accountable: a named partner, a written scope, and a visible record of what was declined.",
  brand: {
    brandName: "Hale & Mercer",
    tone: "Senior, plainspoken, and advisory. Sound like a partner in a scoping conversation.",
    audience: "COOs and general counsels who will have to defend the scope internally.",
    preferredLanguage: "en",
    wordsToUse: ["scope", "decision rights", "named partner", "incident", "declined"],
    wordsToAvoid: ["cutting-edge", "synergy", "guarantee compliance", "holistic"],
    styleGuidance: "Prefer refusals and decision rights over abstract governance language. Do not imply a legal opinion.",
    exampleCopy: "The retainer is a way to see what the company is already doing with models, and to decide who may approve the next one.",
  },
  corpus: [
    {
      id: "covers",
      url: "https://demo.draftline.local/corpus/hale/what-it-covers",
      title: "What the first retainer period covers",
      excerpt:
        "In the notes for a first engagement, the work is an inventory of models and use cases, a review of vendor questions, and an intake path for incidents. It is operational scoping. It is not a build of the client's models.",
      relevance: "Defines the positive scope the brief wants the COO to understand.",
      claim: "A first AI governance retainer covers model inventory, use-case review, vendor questions, and incident intake.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "refusals",
      url: "https://demo.draftline.local/corpus/hale/refusals",
      title: "What the retainer does not certify",
      excerpt:
        "The engagement notes refuse three things buyers often assume are included: running the client's models, a certification that the company is compliant, and a legal opinion as outside counsel unless that work is separately engaged.",
      relevance: "The brief asks for an explicit refusal, not a soft caveat.",
      claim: "The retainer does not certify compliance, run the client's models, or provide outside counsel unless separately engaged.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "board-stat",
      url: "https://demo.draftline.local/corpus/hale/board-stat",
      title: "A cited figure on board AI policies",
      excerpt:
        "A secondary roundup says 73 percent of boards now claim they have an AI policy. The roundup does not link the questionnaire, the year, or the sample. Treat the percentage as unusable until a primary source is in hand.",
      relevance: "A statistic the checker should flag before anyone repeats it.",
      claim: "A secondary roundup says 73 percent of boards claim they have an AI policy.",
      verification: "NEEDS_CURRENT_DATA",
    },
    {
      id: "ninety",
      url: "https://demo.draftline.local/corpus/hale/ninety-days",
      title: "A 90-day sequence a COO can inspect",
      excerpt:
        "The working sequence in the notes is concrete: days 1 to 30 inventory what is already in use, days 31 to 60 write decision rights, and days 61 to 90 run an incident drill against one plausible failure.",
      relevance: "Gives the buyer a shape they can govern, instead of a theme.",
      claim: "The 90-day shape is inventory, then decision rights, then an incident drill.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "accountable",
      url: "https://demo.draftline.local/corpus/hale/accountability",
      title: "How a COO can see whether the firm is accountable",
      excerpt:
        "Accountability in these notes is mundane: a named partner, a written scope, and a record the COO can read of work that was declined because it sat outside that scope. A status meeting with no declined-work list is not the same thing.",
      relevance: "Answers the brief's question about how the buyer judges the firm.",
      claim: "The firm is accountable when a named partner keeps a written scope and a visible record of declined work.",
      verification: "SOURCE_GROUNDED",
    },
  ],
  outline: {
    workingTitle: "An AI governance retainer is a scope, not a certificate",
    thesis:
      "A COO should buy the retainer for inventory, decision rights, and an incident drill — and should walk away from any version that certifies compliance or hides what the firm declined.",
    sections: [
      {
        id: "covers",
        heading: "What the retainer actually covers",
        purpose: "Give the buyer a concrete list, not a theme.",
        bridge: "The useful version of this work is an inventory, a vendor question list, and a path for incidents.",
        evidenceSourceIds: ["covers"],
        wordAllocation: 170,
      },
      {
        id: "refusals",
        heading: "What it refuses to cover",
        purpose: "Make the exclusions as clear as the inclusions.",
        bridge: "The engagement gets healthier when the refusals are written down before the kickoff.",
        evidenceSourceIds: ["refusals"],
        wordAllocation: 160,
      },
      {
        id: "statistic",
        heading: "Do not brief the board with the 73 percent line",
        purpose: "Hold a popular statistic until someone produces the primary source.",
        bridge: "A roundup percentage is not a board paper. The excerpt itself says the sample is missing.",
        evidenceSourceIds: ["board-stat"],
        wordAllocation: 140,
      },
      {
        id: "ninety",
        heading: "A 90-day shape a COO can govern",
        purpose: "Turn the retainer into a sequence with inspection points.",
        bridge: "Inventory, decision rights, and a drill are the three points a COO can ask about without learning a new vocabulary.",
        evidenceSourceIds: ["ninety"],
        wordAllocation: 180,
      },
      {
        id: "accountable",
        heading: "How to tell the firm is accountable",
        purpose: "Give the buyer a test that does not depend on chemistry.",
        bridge: "Look for a named partner, a written scope, and a list of work the firm declined.",
        evidenceSourceIds: ["accountable"],
        wordAllocation: 160,
      },
    ],
  },
};

const relay: DemoPackage = {
  id: "relay-agents",
  category: "relay-agents",
  projectName: "Relay",
  title: "What to settle before coding agents touch production",
  audience: "VP Engineering and platform leads",
  contentGoal: "Give a VP a briefing they can forward to security and platform before agents open pull requests.",
  rawBrief:
    "Write a briefing for a VP of engineering who is under pressure to let coding agents open pull requests against production repositories. Separate local assistance from autonomous merges. Cover access boundaries: repository scope, secrets, and production credentials. Treat review load as a real constraint, not a footnote. Include the popular cycle-time statistic only as a number that needs a primary source. End on the audit trail security will ask for: prompt, tool calls, diff, and the human who approved the merge. Do not sound impressed by the tools.",
  brand: {
    brandName: "Relay",
    tone: "Technical, direct, and skeptical of vendor theatre.",
    audience: "Engineering leaders who will be in the incident review if this goes badly.",
    preferredLanguage: "en",
    wordsToUse: ["access", "review", "diff", "approver", "audit trail"],
    wordsToAvoid: ["magic", "autopilot", "game-changer", "set and forget"],
    styleGuidance: "Write the way a platform lead writes a decision note. Name the boundary, then the failure mode.",
    exampleCopy: "Local completion and an agent that can merge are not two settings of the same feature. They are different threat models.",
  },
  corpus: [
    {
      id: "threat",
      url: "https://demo.draftline.local/corpus/relay/two-threat-models",
      title: "Local assistance and autonomous merge are different threat models",
      excerpt:
        "A coding assistant that proposes a change inside a developer's editor can see one workspace. An agent allowed to open and merge pull requests can move code into the shared branch. The notes treat those as different threat models, not as two speeds of the same tool.",
      relevance: "The distinction the brief says the VP must settle first.",
      claim: "Local assistance and an agent that can merge into a shared branch are different threat models.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "access",
      url: "https://demo.draftline.local/corpus/relay/access-boundaries",
      title: "Access boundaries before any autonomous step",
      excerpt:
        "The platform notes draw a hard line: repository scope is explicit, secret scanning runs before an agent reads a tree, and production credentials never enter the agent runtime. A broader token is not a convenience. It is the incident.",
      relevance: "Gives security a concrete boundary to review.",
      claim: "Production credentials do not belong in the agent runtime, and repository scope has to be explicit.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "review",
      url: "https://demo.draftline.local/corpus/relay/review-load",
      title: "Generated diffs still need a human reviewer",
      excerpt:
        "Every note on adoption comes back to review load. Generated diffs still need a human reviewer, and a higher volume of small changes can hide a risky one. The tool does not retire the review. It can make the review easier to skip.",
      relevance: "Names the constraint engineering leaders actually feel.",
      claim: "Generated diffs still need a human reviewer, and volume can hide risk.",
      verification: "SOURCE_GROUNDED",
    },
    {
      id: "cycle-stat",
      url: "https://demo.draftline.local/corpus/relay/cycle-time-claim",
      title: "A vendor figure on pull-request cycle time",
      excerpt:
        "A vendor post claims agents cut pull-request cycle time by 55 percent. The post does not define cycle time, the baseline, or the repositories. Keep the number out of the decision note until those three are public.",
      relevance: "A statistic that should be flagged rather than repeated.",
      claim: "A vendor post claims agents cut pull-request cycle time by 55 percent.",
      verification: "NEEDS_CURRENT_DATA",
    },
    {
      id: "audit",
      url: "https://demo.draftline.local/corpus/relay/audit-trail",
      title: "What security will ask to reconstruct",
      excerpt:
        "The security review in the notes asks for four artifacts on any agent-authored change: the prompt, the tool calls, the diff, and the human approver. If one of the four is missing, the change is not reconstructable after an incident.",
      relevance: "Ends the brief on an audit standard a VP can forward.",
      claim: "An agent-authored change should retain the prompt, the tool calls, the diff, and the human approver.",
      verification: "SOURCE_GROUNDED",
    },
  ],
  outline: {
    workingTitle: "Settle the threat model before an agent opens a pull request",
    thesis:
      "Coding agents are safe to discuss only after access, review, and audit are decided. Local assistance and autonomous merges are not the same decision, and a cycle-time claim is not a security review.",
    sections: [
      {
        id: "threat",
        heading: "Two different threat models",
        purpose: "Stop the team from treating merge rights as a setting.",
        bridge: "An assistant in an editor and an agent that can merge do not share a blast radius.",
        evidenceSourceIds: ["threat"],
        wordAllocation: 170,
      },
      {
        id: "access",
        heading: "Access before autonomy",
        purpose: "Put repository scope and credentials ahead of any productivity claim.",
        bridge: "If production credentials can reach the agent, the rest of the policy is decorative.",
        evidenceSourceIds: ["access"],
        wordAllocation: 160,
      },
      {
        id: "review",
        heading: "Review load is the constraint",
        purpose: "Treat human review as the limiting factor, not a courtesy.",
        bridge: "More diffs do not make a risky change easier to see. They make it easier to wave through.",
        evidenceSourceIds: ["review"],
        wordAllocation: 160,
      },
      {
        id: "statistic",
        heading: "Leave the 55 percent claim out of the decision",
        purpose: "Refuse a vendor metric that does not define its baseline.",
        bridge: "Cycle time without a definition is not evidence. It is a slide.",
        evidenceSourceIds: ["cycle-stat"],
        wordAllocation: 140,
      },
      {
        id: "audit",
        heading: "An audit trail security can reconstruct",
        purpose: "Give the VP a four-part test to forward.",
        bridge: "Prompt, tool calls, diff, and approver. Missing one means the incident review will stall.",
        evidenceSourceIds: ["audit"],
        wordAllocation: 170,
      },
    ],
  },
};

export const DEMO_PACKAGES: Record<DemoId, DemoPackage> = {
  "northwind-close": northwind,
  "hale-retainer": hale,
  "relay-agents": relay,
};

export function demoPackage(id: string): DemoPackage | null {
  if (id in DEMO_PACKAGES) return DEMO_PACKAGES[id as DemoId];
  return null;
}
