export const NOTEBOOKLM_HOME = "https://notebooklm.google.com/";

const notebookHosts = new Set([
  "notebooklm.google.com",
  "notebooklm.google",
  "notebook.google.com",
]);

/** Normalize only official, standard HTTPS NotebookLM links for use in anchors. */
export function getNotebookUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    let candidate = value.trim();
    const markdown = candidate.match(/^\[[^\]]*\]\((https:\/\/[^\s()]+)\)$/);
    if (markdown) candidate = markdown[1];
    if (/^(?:notebooklm\.google(?:\.com)?|notebook\.google\.com)(?:[/?#]|$)/i.test(candidate)) candidate = `https://${candidate}`;
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      !notebookHosts.has(url.hostname) ||
      url.username || url.password ||
      url.port
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function notebookHref(value: string | null | undefined): string {
  return getNotebookUrl(value) ?? NOTEBOOKLM_HOME;
}
