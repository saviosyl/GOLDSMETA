import { describe, expect, it } from "vitest";
import { isUiReviewHost } from "./uiReviewHost";

describe("isUiReviewHost preview-host restriction", () => {
  it("allows localhost and loopback", () => {
    expect(isUiReviewHost("localhost")).toBe(true);
    expect(isUiReviewHost("127.0.0.1")).toBe(true);
  });

  it("allows Cloudflare Pages and preview hosts", () => {
    expect(isUiReviewHost("goldmeta-web.pages.dev")).toBe(true);
    expect(isUiReviewHost("issue50-preview.example.com")).toBe(true);
  });

  it("denies production GoldMeta domain", () => {
    expect(isUiReviewHost("goldmeta.metamechsolutions.com")).toBe(false);
  });

  it("denies other production metamech hosts without preview", () => {
    expect(isUiReviewHost("api.metamechsolutions.com")).toBe(false);
    expect(isUiReviewHost("www.metamechsolutions.com")).toBe(false);
  });

  it("denies empty hostname", () => {
    expect(isUiReviewHost("")).toBe(false);
  });
});
