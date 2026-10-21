import type Anthropic from "@anthropic-ai/sdk";
import {
  classifyAttachment,
  formatBytes,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_TEXT_CHARS,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/advisor/attachment-kinds";

/**
 * A file attached to an advisor question.
 *
 * Always base64, whatever the kind. The browser reads every file the same way, and a
 * CSV that arrives as bytes cannot be mangled in transit by an encoding guess — the
 * server decodes it once, where the charset decision can be made deliberately.
 */
export type AdvisorAttachment = {
  name: string;
  data: string;
};

export type PreparedAttachments = {
  /** Image and PDF blocks, which ride with this one question. */
  blocks: Anthropic.ContentBlockParam[];
  /**
   * What gets written to the thread alongside the question.
   *
   * A readable file's own text goes in here, so a follow-up turn can still refer to
   * row 14 without the file being attached again. An image or a PDF leaves only a
   * note: re-sending its bytes on every later turn would cost more than it is worth,
   * and the thread would grow without bound.
   */
  transcript: string;
};

/**
 * Turn what the browser sent into content blocks, or say why it cannot be done.
 *
 * Nothing here truncates. A file that will not fit is refused by name and size so the
 * person can split it or narrow the export, because an answer drawn from the first
 * half of a spreadsheet, presented as if it covered all of it, is worse than no answer.
 */
export function prepareAttachments(
  input: unknown,
): { ok: true; prepared: PreparedAttachments } | { ok: false; error: string } {
  if (input === undefined || input === null) {
    return { ok: true, prepared: { blocks: [], transcript: "" } };
  }
  if (!Array.isArray(input)) return { ok: false, error: "Attachments were malformed." };
  if (input.length > MAX_ATTACHMENTS) {
    return {
      ok: false,
      error: `Too many files — attach up to ${MAX_ATTACHMENTS} at a time.`,
    };
  }

  const blocks: Anthropic.ContentBlockParam[] = [];
  const notes: string[] = [];
  let total = 0;

  for (const entry of input as AdvisorAttachment[]) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const data = typeof entry?.data === "string" ? entry.data : "";
    if (!name) return { ok: false, error: "An attachment arrived without a name." };
    if (!data) return { ok: false, error: `${name} is empty.` };

    const classified = classifyAttachment(name);
    if (classified.kind === "unsupported") return { ok: false, error: classified.reason };

    let bytes: Buffer;
    try {
      bytes = Buffer.from(data, "base64");
    } catch {
      return { ok: false, error: `${name} could not be decoded.` };
    }
    if (bytes.length === 0) return { ok: false, error: `${name} is empty.` };
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: `${name} is ${formatBytes(bytes.length)}, over the ${formatBytes(
          MAX_ATTACHMENT_BYTES,
        )} limit for a single file.`,
      };
    }
    total += bytes.length;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: `Those files come to more than ${formatBytes(
          MAX_TOTAL_ATTACHMENT_BYTES,
        )} together. Send them across a couple of questions.`,
      };
    }

    if (classified.kind === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: classified.mediaType as "image/png",
          data,
        },
      });
      notes.push(`[Attached image: ${name}, ${formatBytes(bytes.length)}]`);
      continue;
    }

    if (classified.kind === "pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
      notes.push(`[Attached PDF: ${name}, ${formatBytes(bytes.length)}]`);
      continue;
    }

    const text = bytes.toString("utf8");
    if (text.length > MAX_TEXT_CHARS) {
      return {
        ok: false,
        error: `${name} holds ${text.length.toLocaleString()} characters, past the ${MAX_TEXT_CHARS.toLocaleString()} this chat can take in one go. Narrow the export — a date range or fewer columns — rather than sending part of it, so the answer covers the whole file it claims to.`,
      };
    }
    // Fenced and named so the model can tell one attachment from the next, and tell
    // either from the question wrapped around them.
    notes.push(`Attached file: ${name}\n\n\`\`\`\n${text}\n\`\`\``);
  }

  return { ok: true, prepared: { blocks, transcript: notes.join("\n\n") } };
}
