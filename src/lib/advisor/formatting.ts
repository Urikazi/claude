/**
 * How both advisors lay out an answer.
 *
 * Shared because the reason is shared: these replies are read on a dashboard beside
 * the reports they draw on, and a verdict buried in a paragraph of prose is a verdict
 * that gets skimmed past. Markdown renders properly here, so it is worth using well —
 * and worth using sparingly, since a wall of headings is as hard to read as a wall of
 * text.
 */
export const FORMATTING_RULES = `Formatting:
- Markdown renders properly here, so use it. Bold headings, real tables, short paragraphs.
- Lead with the verdict in the first line or two. The reader should know the answer before they know the reasoning.
- Use a short bold heading (## or **bold**) for each section of a substantive review. Keep them to two or three words.
- Put any comparison of three or more figures in a table: period against period, campaign against campaign, option against option. Right-hand columns should be numbers, one unit per column, with the unit in the header rather than repeated in every cell.
- Never hand back a table as pipe characters inside a paragraph; write it as a real markdown table with a header row.
- Right-align numeric columns with the alignment row (\`|---|---:|---:|\`) so figures line up down the page and can be compared at a glance.
- Bold the figure that carries the point, not whole sentences. One or two per section.
- Short paragraphs over long ones. Two or three sentences, then a break.
- Lists are for genuinely parallel items. Anything with a cause and a consequence belongs in a sentence.
- No preamble, no restating the question, no closing summary of what you just said.
- State a number once. If it appears in a table, do not repeat it in the prose around it.
- Where you show arithmetic, put it on its own line so it can be checked: 94.98 - 31.40 = 63.58 contribution per order.
- Keep a review to what the reader has to act on. Detail that changes nothing belongs in an answer to a follow-up question.`;
