import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScrollToTop } from "../components/ScrollToTop";
import cssText from "../styles/global.css?raw";

describe("V5.3 scrolling hotfix", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not trap wheel events with overflow on .app-shell", () => {
    expect(cssText).toMatch(/\/\* Never set overflow-x\/y here/);
    expect(cssText).toMatch(/\.app-shell[\s\S]*?overflow:\s*visible/);
    expect(cssText).not.toMatch(/\.app-shell\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(cssText).toMatch(/overscroll-behavior-y:\s*auto/);
  });

  it("makes the document the vertical scrollport", () => {
    expect(cssText).toMatch(/html\s*\{[^}]*overflow-y:\s*auto/s);
    expect(cssText).toMatch(/#root\s*\{[^}]*overflow:\s*visible/s);
    expect(cssText).toMatch(/scroll-padding-bottom/);
  });

  it("reserves bottom space so fixed nav does not cover content", () => {
    expect(cssText).toMatch(/padding-bottom:\s*calc\(88px \+ var\(--safe-bottom\)\)/);
  });

  it("ScrollToTop calls window.scrollTo on route change", async () => {
    let y = 400;
    const scrollTo = vi.fn((...args: unknown[]) => {
      if (typeof args[0] === "object" && args[0] && "top" in (args[0] as object)) {
        y = Number((args[0] as { top: number }).top);
      } else if (typeof args[1] === "number") {
        y = args[1];
      }
    });
    vi.stubGlobal("scrollTo", scrollTo);
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <ScrollToTop />
        <Link to="/b">Go B</Link>
        <Routes>
          <Route path="/a" element={<div>A</div>} />
          <Route path="/b" element={<div>B</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(scrollTo).toHaveBeenCalled();
    y = 400;
    await user.click(screen.getByRole("link", { name: "Go B" }));
    expect(await screen.findByText("B")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
    expect(y).toBe(0);
  });
});
