/**
 * Which commit the running build was made from.
 *
 * Without it, "the page has not changed" and "the deployment has not landed" look
 * identical from the browser, and the only way to tell them apart is to ask someone to
 * go and read a deployment log. Vercel sets these at build time.
 */
export function BuildMarker() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  if (!sha) return <span className="text-[10px] text-muted/60">dev build</span>;

  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0];
  return (
    <span
      className="text-[10px] text-muted/60"
      title={message ? `${sha}\n${message}` : sha}
    >
      build {sha.slice(0, 7)}
    </span>
  );
}
