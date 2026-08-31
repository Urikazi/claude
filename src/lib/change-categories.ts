/**
 * What kind of edit was made, so a pattern across many changes is readable.
 *
 * Kept out of `actions.ts` because a "use server" module may only export async
 * functions; a constant there fails the build rather than being tree-shaken away.
 */
export const CHANGE_CATEGORIES = [
  { value: "creative", label: "Ad creative" },
  { value: "landing_page", label: "Landing page" },
  { value: "price", label: "Price" },
  { value: "offer", label: "Offer or bundle" },
  { value: "product", label: "Product or catalogue" },
  { value: "other", label: "Other" },
] as const;

export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number]["value"];
