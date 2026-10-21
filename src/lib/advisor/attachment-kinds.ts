/**
 * What an advisor chat will accept as an attachment, and what it calls each kind.
 *
 * Browser-safe on purpose: the file picker, the size check and the "that's an Excel
 * file" message all have to run before anything is uploaded, so none of this may
 * depend on the server half.
 */
/**
 * What the request body may carry.
 *
 * Deliberately smaller than what the API itself accepts. A serverless request body is
 * capped well below Anthropic's 32 MB, so the binding constraint is the hop in front of
 * the model, not the model — and a limit that rejects a file in the browser is kinder
 * than one that returns a 413 after the upload.
 */
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 3_500_000;
export const MAX_TOTAL_ATTACHMENT_BYTES = 3_500_000;
/// Beyond this a text file is not a document to read, it is a database to query.
export const MAX_TEXT_CHARS = 200_000;

type Kind = "image" | "pdf" | "text";

const BY_EXTENSION: Record<string, { kind: Kind; mediaType: string }> = {
  png: { kind: "image", mediaType: "image/png" },
  jpg: { kind: "image", mediaType: "image/jpeg" },
  jpeg: { kind: "image", mediaType: "image/jpeg" },
  gif: { kind: "image", mediaType: "image/gif" },
  webp: { kind: "image", mediaType: "image/webp" },
  pdf: { kind: "pdf", mediaType: "application/pdf" },
  csv: { kind: "text", mediaType: "text/csv" },
  tsv: { kind: "text", mediaType: "text/tab-separated-values" },
  txt: { kind: "text", mediaType: "text/plain" },
  md: { kind: "text", mediaType: "text/markdown" },
  json: { kind: "text", mediaType: "application/json" },
};

/// Named so the browser's file picker offers the right files rather than everything.
export const ATTACHMENT_ACCEPT = Object.keys(BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * What kind of file this is, decided by extension rather than by what the browser said.
 *
 * Browsers disagree about CSVs: the same file is `text/csv` on one machine and
 * `application/vnd.ms-excel` on a Windows box with Excel installed. The extension is
 * the thing the person actually chose, so it decides, and the media type Meta's — or
 * anyone's — export tooling guessed is ignored.
 */
export function classifyAttachment(
  name: string,
): { kind: Kind; mediaType: string } | { kind: "unsupported"; reason: string } {
  const extension = extensionOf(name);
  const known = BY_EXTENSION[extension];
  if (known) return known;
  if (extension === "xlsx" || extension === "xls") {
    return {
      kind: "unsupported",
      reason: `${name} is an Excel workbook, which cannot be read directly. Open it and save the sheet as CSV, then attach that.`,
    };
  }
  return {
    kind: "unsupported",
    reason: `${name} is not a file type this chat can read. Attach a CSV, PDF, image, or plain text file.`,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
