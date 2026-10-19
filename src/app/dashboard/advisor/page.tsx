import { redirect } from "next/navigation";
import { ADVISOR_AGENTS } from "@/lib/advisor/agents";

/// The bare path is a leftover from when there was only one advisor.
export default function AdvisorIndex() {
  redirect(`/dashboard/advisor/${ADVISOR_AGENTS[0].key}`);
}
