/**
 * Share / download helpers for Market Snapshot PNG.
 */

import { buildSnapshotFilename } from "./promoSnapshot";

export type ShareResult =
  | { ok: true; mode: "share" | "download" | "cancelled" }
  | { ok: false; mode: "error"; message: string };

export function canNativeShareFile(file: File): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
    if (typeof navigator.canShare !== "function") return false;
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareOrDownloadSnapshot(
  blob: Blob,
  decision: string,
  compactTime: string
): Promise<ShareResult> {
  const filename = buildSnapshotFilename(decision, compactTime);
  const file = new File([blob], filename, { type: "image/png" });

  if (canNativeShareFile(file)) {
    try {
      await navigator.share({
        files: [file],
        title: "GoldMeta XAUUSD Market Snapshot",
        text: "GoldMeta XAUUSD market intelligence"
      });
      return { ok: true, mode: "share" };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError") return { ok: true, mode: "cancelled" };
      // fall through to download
    }
  }

  downloadBlob(blob, filename);
  return { ok: true, mode: "download" };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke after the click has a chance to start
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
}

export function createPreviewObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokePreviewObjectUrl(url: string | null | undefined): void {
  if (url) URL.revokeObjectURL(url);
}
