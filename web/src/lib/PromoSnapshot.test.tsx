import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SNAPSHOT_DISCLAIMER,
  SNAPSHOT_FORMATS,
  SNAPSHOT_SITE,
  analysisLabelFor,
  buildPromoSnapshotModel,
  buildSnapshotFilename,
  decisionTone,
  getSnapshotFormat
} from "../lib/promoSnapshot";
import {
  canNativeShareFile,
  downloadBlob,
  revokePreviewObjectUrl,
  shareOrDownloadSnapshot
} from "../lib/promoSnapshotShare";
import { PromoSnapshotModal } from "../components/v5/PromoSnapshotModal";
import { PromoSnapshotButton } from "../components/v5/PromoSnapshotButton";
import { DEFAULT_SNAPSHOT_OPTIONS } from "../lib/promoSnapshot";

describe("snapshot formats", () => {
  it("defines Social Post 1080×1350 as default", () => {
    expect(getSnapshotFormat("social")).toEqual({
      id: "social",
      label: "Social Post",
      width: 1080,
      height: 1350
    });
    expect(SNAPSHOT_FORMATS[0]?.id).toBe("social");
  });

  it("defines Story 1080×1920", () => {
    expect(getSnapshotFormat("story")).toMatchObject({ width: 1080, height: 1920 });
  });

  it("defines Square 1080×1080", () => {
    expect(getSnapshotFormat("square")).toMatchObject({ width: 1080, height: 1080 });
  });

  it("defines Compact 1200×675", () => {
    expect(getSnapshotFormat("compact")).toMatchObject({ width: 1200, height: 675 });
  });
});

describe("snapshot colours and labels", () => {
  it("maps BUY / SELL / WAIT tones and analysis labels", () => {
    expect(decisionTone("BUY")).toBe("buy");
    expect(decisionTone("SELL")).toBe("sell");
    expect(decisionTone("WAIT")).toBe("wait");
    expect(analysisLabelFor("BUY")).toBe("GoldMeta Analysis: BUY");
    expect(analysisLabelFor("SELL")).toBe("GoldMeta Analysis: SELL");
    expect(analysisLabelFor("WAIT")).toBe("GoldMeta Analysis: WAIT");
  });
});

describe("buildPromoSnapshotModel", () => {
  const base = {
    decision: "WAIT",
    scoreTotal: 61,
    livePrice: 2385.4,
    sessionLabel: "New York",
    compactTime: "07:15",
    timeZone: "Europe/Dublin",
    utcSecondary: "06:15 UTC",
    ladder: { livePrice: 2385.4, poc: 2380, vah: 2390, val: 2370 }
  };

  it("renders POC / VAH / VAL / live price from verified data", () => {
    const model = buildPromoSnapshotModel(base);
    expect(model.levels.some((l) => l.classification.includes("POC"))).toBe(true);
    expect(model.levels.some((l) => /VAH/i.test(l.classification))).toBe(true);
    expect(model.levels.some((l) => /VAL/i.test(l.classification))).toBe(true);
    expect(model.levels.some((l) => l.isLive)).toBe(true);
    expect(model.livePrice).toBe(2385.4);
    expect(model.compactTime).toBe("07:15");
    expect(model.timeZone).toBe("Europe/Dublin");
  });

  it("omits missing levels cleanly", () => {
    const model = buildPromoSnapshotModel({
      ...base,
      ladder: { livePrice: 100 }
    });
    expect(model.levels.every((l) => Number.isFinite(l.price))).toBe(true);
    expect(model.levels.some((l) => l.isLive)).toBe(true);
  });

  it("renders validated shadow plan", () => {
    const model = buildPromoSnapshotModel({
      ...base,
      decision: "BUY",
      plan: {
        direction: "BUY",
        status: "ACTIVE_SHADOW",
        levels: { entryPrice: 2384, stopLoss: 2370, tp1: 2395, tp2: 2405, tp3: 2415 }
      }
    });
    expect(model.plan).not.toBeNull();
    expect(model.plan?.entry).toBe(2384);
    expect(model.plan?.riskReward).toBeGreaterThan(0);
    expect(model.analysisLabel).toBe("GoldMeta Analysis: BUY");
  });

  it("shows no-plan state when levels missing", () => {
    const model = buildPromoSnapshotModel({
      ...base,
      plan: { direction: "BUY", status: "WAIT", levels: {} }
    });
    expect(model.plan).toBeNull();
  });

  it("never includes private account fields", () => {
    const model = buildPromoSnapshotModel(base);
    const json = JSON.stringify(model);
    expect(json).not.toMatch(/@|firebase|decisionId|webhook/i);
  });
});

describe("filename and disclaimer constants", () => {
  it("builds safe PNG filename", () => {
    const name = buildSnapshotFilename("WAIT", "07:15", new Date("2026-07-22T06:15:00.000Z"));
    expect(name).toBe("GoldMeta-XAUUSD-WAIT-2026-07-22-0715.png");
  });

  it("exposes disclaimer and site", () => {
    expect(SNAPSHOT_DISCLAIMER).toMatch(/not a probability of profit/i);
    expect(SNAPSHOT_SITE).toBe("goldmeta.metamechsolutions.com");
  });
});

describe("share helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("detects native Share API support", () => {
    vi.stubGlobal("navigator", {
      canShare: () => true,
      share: vi.fn()
    });
    const file = new File([new Blob(["x"])], "a.png", { type: "image/png" });
    expect(canNativeShareFile(file)).toBe(true);
  });

  it("falls back to download when Share unsupported", async () => {
    vi.stubGlobal("navigator", {});
    const click = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === "a") {
        Object.defineProperty(el, "click", { value: click });
      }
      return el;
    });
    const blob = new Blob(["png"], { type: "image/png" });
    const result = await shareOrDownloadSnapshot(blob, "WAIT", "07:15");
    expect(result.mode).toBe("download");
    expect(click).toHaveBeenCalled();
  });

  it("treats AbortError as cancelled quietly", async () => {
    vi.stubGlobal("navigator", {
      canShare: () => true,
      share: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }))
    });
    const blob = new Blob(["png"], { type: "image/png" });
    const result = await shareOrDownloadSnapshot(blob, "BUY", "07:15");
    expect(result).toEqual({ ok: true, mode: "cancelled" });
  });

  it("revokes object URLs", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: revoke, createObjectURL: () => "blob:x" });
    revokePreviewObjectUrl("blob:x");
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });

  it("downloadBlob creates anchor", () => {
    const click = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = createElement(tag);
      if (tag === "a") Object.defineProperty(el, "click", { value: click });
      return el;
    });
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:dl",
      revokeObjectURL: vi.fn()
    });
    downloadBlob(new Blob(["x"]), "GoldMeta-XAUUSD-WAIT-2026-07-22-0715.png");
    expect(click).toHaveBeenCalled();
  });
});

describe("PromoSnapshotModal UI", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      crossOrigin = "";
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
  });

  it("renders controls and is keyboard closable", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PromoSnapshotModal
        open
        onClose={onClose}
        options={DEFAULT_SNAPSHOT_OPTIONS}
        onOptionsChange={vi.fn()}
        status="ready"
        statusMessage="Snapshot ready"
        previewUrl="blob:preview"
        generating={false}
        onShare={vi.fn()}
        onDownload={vi.fn()}
      />
    );
    expect(screen.getByTestId("promo-snapshot-modal")).toBeInTheDocument();
    expect(screen.getByTestId("promo-snapshot-preview")).toBeInTheDocument();
    expect(screen.getByTestId("promo-snapshot-share")).toBeInTheDocument();
    expect(screen.getByTestId("promo-snapshot-download")).toBeInTheDocument();
    expect(screen.getByTestId("promo-snapshot-preview-wrap").className).toMatch(/preview/);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("exposes accessible trigger label", () => {
    render(<PromoSnapshotButton onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: /share market snapshot/i })).toBeInTheDocument();
  });
});

describe("renderPromoSnapshotPng dimensions", () => {
  it("exports exact Social / Story / Square / Compact sizes", async () => {
    class FakeCtx {
      fillStyle = "";
      strokeStyle = "";
      lineWidth = 1;
      font = "";
      textAlign = "left";
      fillRect() {}
      beginPath() {}
      moveTo() {}
      lineTo() {}
      arcTo() {}
      closePath() {}
      fill() {}
      stroke() {}
      fillText() {}
      arc() {}
      drawImage() {}
      save() {}
      restore() {}
      measureText(t: string) {
        return { width: String(t).length * 8 };
      }
    }
    const sizes: Array<{ w: number; h: number }> = [];
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const canvas = orig("canvas") as HTMLCanvasElement;
        Object.defineProperty(canvas, "getContext", {
          value: () => new FakeCtx()
        });
        Object.defineProperty(canvas, "toBlob", {
          value: (cb: (b: Blob | null) => void) => {
            sizes.push({ w: canvas.width, h: canvas.height });
            cb(new Blob([`png-${canvas.width}x${canvas.height}`], { type: "image/png" }));
          }
        });
        return canvas;
      }
      return orig(tag);
    });
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    });

    const { renderPromoSnapshotPng } = await import("../lib/promoSnapshotRender");
    const model = buildPromoSnapshotModel({
      decision: "WAIT",
      scoreTotal: 61,
      livePrice: 2385.4,
      sessionLabel: "Asia",
      compactTime: "07:15",
      timeZone: "UTC",
      utcSecondary: "07:15 UTC",
      ladder: { livePrice: 2385.4, poc: 2380, vah: 2390, val: 2370 }
    });
    for (const id of ["social", "story", "square", "compact"] as const) {
      const blob = await renderPromoSnapshotPng(model, { ...DEFAULT_SNAPSHOT_OPTIONS, formatId: id });
      expect(blob.type).toBe("image/png");
    }
    expect(sizes).toEqual([
      { w: 1080, h: 1350 },
      { w: 1080, h: 1920 },
      { w: 1080, h: 1080 },
      { w: 1200, h: 675 }
    ]);
  });
});
