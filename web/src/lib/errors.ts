import { ApiError } from "../types/models";
import { friendlyApiCode } from "./plainLanguage";

const NETWORK_ERROR_PATTERN = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

export type FriendlyErrorDetail = {
  /** Plain-language summary for the banner. */
  message: string;
  /** What happened. */
  whatHappened: string;
  /** Whether market data and/or trading is affected. */
  impact: string;
  /** What the user should do next. */
  nextStep: string;
  /** Raw technical string for expandable disclosure only. */
  technical?: string;
};

/** Map known API / Firebase / env codes to safe user copy. Never show raw codes by default. */
export function describeClientError(err: unknown, fallback: string): FriendlyErrorDetail {
  if (err instanceof ApiError) {
    const mapped = friendlyApiCode(err.code, err.message, err.status);
    return {
      message: mapped.message,
      whatHappened: mapped.whatHappened,
      impact: mapped.impact,
      nextStep: mapped.nextStep,
      technical: `${err.status} ${err.code}: ${err.message}`
    };
  }

  if (err instanceof TypeError || (err instanceof Error && NETWORK_ERROR_PATTERN.test(err.message))) {
    return {
      message: "Could not reach GoldMeta right now. Check your connection and try again.",
      whatHappened: "The app could not reach the GoldMeta service from this browser.",
      impact: "Live market data may be outdated until the connection recovers. Trading stays locked.",
      nextStep: "Check your internet connection, then tap Retry or Refresh.",
      technical: err instanceof Error ? err.message : "network"
    };
  }

  if (err instanceof Error && err.message.trim().length > 0) {
    const cleaned = stripRawCodes(err.message);
    return {
      message: cleaned || fallback,
      whatHappened: cleaned || fallback,
      impact: "Some information on this page may be incomplete.",
      nextStep: "Try again in a moment. If the problem continues, open Help or contact support.",
      technical: err.message
    };
  }

  return {
    message: fallback,
    whatHappened: fallback,
    impact: "Some information on this page may be incomplete.",
    nextStep: "Try again in a moment.",
    technical: undefined
  };
}

/** Friendly message for UI banners; never prefixes raw API codes. */
export const formatClientError = (err: unknown, fallback: string): string => {
  return describeClientError(err, fallback).message;
};

function stripRawCodes(message: string): string {
  if (/auth\//i.test(message) || /Firebase:\s*Error/i.test(message)) {
    return "Something went wrong while signing in. Please try again.";
  }
  if (/CTRADER_|BROKER_|AUTH_SETUP|FORBIDDEN|INTERNAL/i.test(message) && message.includes("_")) {
    return "Something went wrong. Please try again from this page.";
  }
  return message;
}
