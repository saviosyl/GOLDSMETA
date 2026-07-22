import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyFirebaseIdToken = vi.fn();

vi.mock("../../src/services/firebaseAdmin", () => ({
  verifyFirebaseIdToken: (...args: unknown[]) => verifyFirebaseIdToken(...args)
}));

describe("auth middleware admin claim", () => {
  beforeEach(() => {
    verifyFirebaseIdToken.mockReset();
    vi.resetModules();
  });

  it("sets isAdmin from Firebase custom claim", async () => {
    verifyFirebaseIdToken.mockResolvedValue({ uid: "admin-1", admin: true });
    const { requireAuth, requireAdmin } = await import("../../src/middleware/auth");

    const req = {
      header: (name: string) => (name === "authorization" ? "Bearer tok" : undefined),
      userId: undefined,
      isAdmin: undefined
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe("admin-1");
    expect(req.isAdmin).toBe(true);

    const next2 = vi.fn() as NextFunction;
    requireAdmin(req, res, next2);
    expect(next2).toHaveBeenCalled();
  });

  it("requireAdmin returns 403 when claim missing", async () => {
    const { requireAdmin } = await import("../../src/middleware/auth");
    const req = { userId: "user-1", isAdmin: false } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
