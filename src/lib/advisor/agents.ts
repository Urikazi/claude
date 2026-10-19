import type { DateRange } from "@/lib/pnl";
import { CFO_SYSTEM_PROMPT } from "@/lib/advisor/cfo-prompt";
import { MEDIA_BUYER_SYSTEM_PROMPT } from "@/lib/advisor/media-buyer-prompt";
import { buildAdvisorContext } from "@/lib/advisor/context";
import { buildMediaBuyerContext } from "@/lib/advisor/media-buyer-context";

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
};

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
];

export function findAdvisorAgent(key: string | undefined): AdvisorAgent | undefined {
  return ADVISOR_AGENTS.find((agent) => agent.key === key);
}
