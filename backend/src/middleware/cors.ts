import cors from "cors";
import type { RequestHandler } from "express";

/** Origins allowed to call the GoldMeta API from a browser. */
export const ALLOWED_WEB_ORIGINS = [
  "https://goldmeta.metamechsolutions.com",
  "https://goldmeta-web.pages.dev",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
] as const;

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) {
    return true;
  }
  if ((ALLOWED_WEB_ORIGINS as readonly string[]).includes(origin)) {
    return true;
  }
  // Cloudflare Pages preview deployments for this project only.
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".goldmeta-web.pages.dev");
  } catch {
    return false;
  }
};

export const buildCorsMiddleware = (): RequestHandler =>
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    maxAge: 86400,
    optionsSuccessStatus: 204
  });
