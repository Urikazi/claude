import "server-only";
import { prisma } from "@/lib/db";

/**
 * Which Claude model the advisors run on.
 *
 * Opus 5.5 is the default because this is the work these briefs describe — reconciling
 * figures, challenging an assumption, sizing a recommendation — and at a few
 * conversations a week the model cost is noise against what the advice is about. But
 * the choice belongs to whoever pays the bill, so it is a setting rather than a
 * constant.
 *
 * The models do not take the same request. Haiku has no server-side fallback for a
 * refusal, so sending the parameter to it is an error rather than a no-op; that is
 * recorded here instead of being discovered as a 400 in production.
 */

export type AdvisorModel = {
  id: string;
  label: string;
  /** USD per million tokens, for showing the operator what a choice costs. */
  inputPerMillion: number;
  outputPerMillion: number;
  note: string;
  /**
   * Whether the API will re-run a safety-declined request on another model inside the
   * same call. Where it will not, the parameter must be left off.
   */
  serverSideFallback: boolean;
};

export const ADVISOR_MODELS: AdvisorModel[] = [
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    inputPerMillion: 4,
    outputPerMillion: 20,
    note: "The default. Best at the reconciliation and judgement these briefs ask for.",
    serverSideFallback: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    inputPerMillion: 2,
    outputPerMillion: 10,
    note: "Half the cost. Fine for reading a snapshot back; weaker at spotting that a figure cannot be right.",
    serverSideFallback: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Haiku 5.5",
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    note: "Cheapest by far. Suitable for quick lookups, not for a review you would act on.",
    serverSideFallback: false,
  },
  {
    id: "claude-fable-5-1",
    label: "Fable 5.1",
    inputPerMillion: 10,
    outputPerMillion: 50,
    note: "Most capable, and the slowest and dearest. Worth it only for a hard question you are stuck on.",
    serverSideFallback: true,
  },
];

export const DEFAULT_ADVISOR_MODEL = ADVISOR_MODELS[0];

const KEY = "advisor.model";

export function findAdvisorModel(id: string | null | undefined): AdvisorModel | undefined {
  return ADVISOR_MODELS.find((model) => model.id === id);
}

/** The chosen model, falling back to the default if the stored id is unknown. */
export async function getAdvisorModel(): Promise<AdvisorModel> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return findAdvisorModel(row?.value) ?? DEFAULT_ADVISOR_MODEL;
}

export async function setAdvisorModel(id: string): Promise<boolean> {
  if (!findAdvisorModel(id)) return false;
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: id },
    update: { value: id },
  });
  return true;
}

/**
 * Roughly what one turn costs on a model, for the settings page.
 *
 * A turn is the brief, the snapshot and the thread going up, and a few thousand tokens
 * of reply coming back. Approximate by construction — it moves with how long the
 * conversation has run — so it is shown as a guide, not a quote.
 */
export function approximateTurnCost(model: AdvisorModel): string {
  const inputTokens = 8_000;
  const outputTokens = 2_500;
  const cost =
    (inputTokens / 1_000_000) * model.inputPerMillion +
    (outputTokens / 1_000_000) * model.outputPerMillion;
  return `$${cost.toFixed(3)}`;
}
