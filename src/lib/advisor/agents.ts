import type { DateRange } from "@/lib/pnl";
import { CFO_SYSTEM_PROMPT } from "@/lib/advisor/cfo-prompt";
import { MEDIA_BUYER_SYSTEM_PROMPT } from "@/lib/advisor/media-buyer-prompt";
import { buildAdvisorContext } from "@/lib/advisor/context";
import { buildMediaBuyerContext } from "@/lib/advisor/media-buyer-context";
import { CRO_SYSTEM_PROMPT } from "@/lib/advisor/cro-prompt";
import { buildCroContext } from "@/lib/advisor/cro-context";

/**
 * The advisors a store can talk to.
 *
 * Each pairs a brief with the snapshot that brief needs: the CFO gets the P&L and the
 * cost provenance, the media buyer gets campaign performance and the inputs for a
 * break-even CPA. Giving both the same snapshot would leave one reasoning about
 * campaigns from a profit statement, or setting a CPA target with no margin to pay it
 * out of — which is exactly what each brief refuses to do.
 */
export type AdvisorAgent = {
  key: string;
  label: string;
  /** One line under the page title. */
  blurb: string;
  systemPrompt: string;
  /** How much trading history its snapshot covers. */
  days: number;
  buildContext: (storeId: string, range: DateRange) => Promise<string>;
  suggestions: string[];
  /**
   * The one store this advisor is for, by name, where it is not for all of them.
   *
   * The CRO brief names a product, its shade ranges and its offer outright, so pointing
   * it at another catalogue would have it reasoning confidently about a foundation stick
   * that store does not sell. Matched on the name rather than an id so the restriction
   * survives a reseeded database.
   */
  onlyForStore?: string;
};

/**
 * Whether this advisor is offered for a store, by the store's own name.
 *
 * Case and punctuation are stripped and the match is on containment, so "Derma Muse",
 * "derma muse", "DermaMuse" and "Derma Muse EU" all qualify. A store named by hand
 * should not quietly lose an advisor over a capital letter or a market suffix, and no
 * unrelated brand is going to have the name inside its own.
 */
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function advisorAvailableFor(agent: AdvisorAgent, storeName: string): boolean {
  if (!agent.onlyForStore) return true;
  return normalize(storeName).includes(normalize(agent.onlyForStore));
}

export const ADVISOR_AGENTS: AdvisorAgent[] = [
  {
    key: "cfo",
    label: "CFO",
    blurb:
      "A fractional CFO, working from this store's own numbers. It reads the figures; it cannot change anything, place an order, or spend money.",
    systemPrompt: CFO_SYSTEM_PROMPT,
    // A quarter: long enough for the period comparison and cohort questions the brief asks.
    days: 90,
    buildContext: buildAdvisorContext,
    suggestions: [
      "Give me the financial verdict on the last 90 days.",
      "What are my three largest profit leaks, quantified?",
      "What can I afford to pay to acquire a customer?",
      "Which destinations lose money once fees and fulfilment are in?",
    ],
  },
  {
    key: "media-buyer",
    label: "Media buyer",
    blurb:
      "A senior Meta Ads buyer, reading this store's campaign performance against what Shopify actually recorded. It reads the figures; it cannot touch a campaign, a budget or a bid.",
    systemPrompt: MEDIA_BUYER_SYSTEM_PROMPT,
    // Fourteen days: the window the brief opens with, and enough for a 7-vs-7 read.
    days: 14,
    buildContext: buildMediaBuyerContext,
    suggestions: [
      "Scale, hold or reduce? Give me the verdict and the evidence.",
      "What is my break-even CPA, and what should I be targeting?",
      "Where is Meta's ROAS disagreeing with Shopify, and what does that imply?",
      "Which campaign should I cut first, and what would make me reverse it?",
    ],
  },
  {
    key: "cro",
    label: "Conversion rate expert",
    blurb:
      "A senior CRO strategist for Derma Muse, reading this store's funnel and its logged changes. It cannot open the site: paste a page, an ad or an export and it audits that.",
    systemPrompt: CRO_SYSTEM_PROMPT,
    // Thirty days: enough visits for a conversion rate to mean anything, and the window
    // the change log's before-and-after comparisons sit inside.
    days: 30,
    buildContext: buildCroContext,
    onlyForStore: "Derma Muse",
    suggestions: [
      "Where is the biggest leak in the funnel right now?",
      "What is a conversion worth, and what can I afford to give away to win one?",
      "Read the change log: what actually worked, and what was noise?",
      "What should I launch first, and what would count as a win?",
    ],
  },
];

export function findAdvisorAgent(key: string | undefined): AdvisorAgent | undefined {
  return ADVISOR_AGENTS.find((agent) => agent.key === key);
}
