import type { SupportDraft } from "@/lib/support/prompt";

export type SupportMode = "off" | "draft" | "auto";

export function parseSupportMode(value: string | null | undefined): SupportMode {
  return value === "draft" || value === "auto" ? value : "off";
}

/**
 * Categories a reply may be sent in without a person reading it first. Everything
 * involving money back, a fault or an unhappy customer is a draft, whatever the model
 * thinks of its own answer.
 */
const AUTO_SEND_CATEGORIES = new Set<SupportDraft["category"]>([
  "order_status",
  "shipping",
  "product_question",
]);

/**
 * Words that put a message beyond an unreviewed reply however routine it looks. A
 * backstop to the model's own judgement, not a replacement for it: the model is asked
 * the same question, and this only catches the case where it answers wrongly.
 */
const ESCALATION_PATTERN =
  /\b(chargeback|charge back|dispute|lawyer|solicitor|legal action|sue|trading standards|fraud|scam|stolen|refund|money back|damaged|broken|allerg|injur|hospital)/i;

export type Decision =
  | { action: "reply"; reason: string }
  | { action: "note"; reason: string }
  | { action: "skip"; reason: string };

/**
 * What to do with a draft. Sending is the exception and needs every check to pass;
 * any single failure falls back to a private note, never to silence.
 */
export function decide(
  mode: SupportMode,
  draft: SupportDraft,
  customerText: string,
  context: { hasRequesterEmail: boolean },
): Decision {
  if (!draft.needs_reply || !draft.reply.trim()) {
    return { action: "skip", reason: draft.reason || "Claude judged that no reply is needed." };
  }
  if (mode !== "auto") return { action: "note", reason: draft.reason };

  const blockers: string[] = [];
  if (!draft.send_directly) blockers.push("Claude asked for a review");
  if (draft.confidence !== "high") blockers.push(`confidence was ${draft.confidence}`);
  if (!AUTO_SEND_CATEGORIES.has(draft.category)) {
    blockers.push(`${draft.category.replace(/_/g, " ")} is never sent automatically`);
  }
  const escalation = ESCALATION_PATTERN.exec(customerText);
  if (escalation) blockers.push(`the message mentions "${escalation[0]}"`);
  if (!context.hasRequesterEmail) blockers.push("the requester has no email address");

  if (blockers.length) {
    return { action: "note", reason: `Drafted, not sent: ${blockers.join("; ")}. ${draft.reason}` };
  }
  return { action: "reply", reason: draft.reason };
}
