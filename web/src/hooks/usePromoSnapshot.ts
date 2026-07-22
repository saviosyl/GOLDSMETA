import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SNAPSHOT_OPTIONS,
  buildPromoSnapshotModel,
  type BuildSnapshotInput,
  type PromoSnapshotModel,
  type SnapshotOptions
} from "../lib/promoSnapshot";
import { renderPromoSnapshotPng } from "../lib/promoSnapshotRender";
import {
  createPreviewObjectUrl,
  downloadBlob,
  revokePreviewObjectUrl,
  shareOrDownloadSnapshot,
  type ShareResult
} from "../lib/promoSnapshotShare";
import { buildSnapshotFilename } from "../lib/promoSnapshot";

export type SnapshotStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "sharing"
  | "shared"
  | "download-ready"
  | "unable-share"
  | "error";

export function usePromoSnapshot(buildInput: () => BuildSnapshotInput | null) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SnapshotOptions>(DEFAULT_SNAPSHOT_OPTIONS);
  const [status, setStatus] = useState<SnapshotStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [model, setModel] = useState<PromoSnapshotModel | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const generating = useRef(false);
  const previewUrlRef = useRef<string | null>(null);

  const clearPreview = useCallback(() => {
    revokePreviewObjectUrl(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setBlob(null);
  }, []);

  useEffect(() => {
    return () => {
      revokePreviewObjectUrl(previewUrlRef.current);
    };
  }, []);

  const generate = useCallback(
    async (opts: SnapshotOptions = options) => {
      if (generating.current) return;
      generating.current = true;
      setStatus("preparing");
      setStatusMessage("Preparing snapshot…");
      clearPreview();
      try {
        const input = buildInput();
        if (!input) {
          setStatus("error");
          setStatusMessage("Unable to prepare snapshot — verified market data is missing.");
          return;
        }
        const nextModel = buildPromoSnapshotModel(input);
        setModel(nextModel);
        const png = await renderPromoSnapshotPng(nextModel, opts);
        const url = createPreviewObjectUrl(png);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setBlob(png);
        setStatus("ready");
        setStatusMessage("Snapshot ready");
      } catch (err) {
        setStatus("error");
        setStatusMessage(err instanceof Error ? err.message : "Unable to create snapshot");
      } finally {
        generating.current = false;
      }
    },
    [buildInput, clearPreview, options]
  );

  const openModal = useCallback(() => {
    setOpen(true);
    setOptions(DEFAULT_SNAPSHOT_OPTIONS);
    void generate(DEFAULT_SNAPSHOT_OPTIONS);
  }, [generate]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setStatus("idle");
    setStatusMessage("");
    clearPreview();
  }, [clearPreview]);

  const updateOptions = useCallback(
    (patch: Partial<SnapshotOptions>) => {
      setOptions((prev) => {
        const next = { ...prev, ...patch };
        void generate(next);
        return next;
      });
    },
    [generate]
  );

  const share = useCallback(async (): Promise<ShareResult | null> => {
    if (!blob || !model || generating.current) return null;
    setStatus("sharing");
    setStatusMessage("Preparing share…");
    const result = await shareOrDownloadSnapshot(blob, model.decision, model.compactTime);
    if (result.mode === "share") {
      setStatus("shared");
      setStatusMessage("Shared successfully");
    } else if (result.mode === "download") {
      setStatus("unable-share");
      setStatusMessage("Unable to share — use Download PNG");
    } else if (result.mode === "cancelled") {
      setStatus("ready");
      setStatusMessage("Snapshot ready");
    } else if (!result.ok) {
      setStatus("error");
      setStatusMessage(result.message);
    }
    return result;
  }, [blob, model]);

  const download = useCallback(() => {
    if (!blob || !model) return;
    const filename = buildSnapshotFilename(model.decision, model.compactTime);
    downloadBlob(blob, filename);
    setStatus("download-ready");
    setStatusMessage("Download ready");
  }, [blob, model]);

  return {
    open,
    openModal,
    closeModal,
    options,
    updateOptions,
    status,
    statusMessage,
    model,
    previewUrl,
    blob,
    share,
    download,
    generating: status === "preparing" || status === "sharing"
  };
}
