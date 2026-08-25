/* eslint-disable @typescript-eslint/require-await -- sync fail-closed impl of async port */
/**
 * Fail-closed signal-outcome store — refuses create/monitor when Firestore is down.
 * Never silently falls back to memory in production/serverless.
 */

import type {
  ApplyBarResult,
  SignalBarInput,
  SignalOutcomeRecord,
  SignalPerformanceDailyAggregate
} from "./types";
import type { ActiveMatchFilter, SignalOutcomeStore } from "./store";
import { SignalOutcomeStorageUnavailableError } from "./storagePolicy";

export class FailClosedSignalOutcomeStore implements SignalOutcomeStore {
  private fail(): never {
    throw new SignalOutcomeStorageUnavailableError();
  }

  async save(_record: SignalOutcomeRecord): Promise<SignalOutcomeRecord> {
    return this.fail();
  }
  async get(_userId: string, _signalId: string): Promise<SignalOutcomeRecord | null> {
    return this.fail();
  }
  async getByDecisionId(
    _userId: string,
    _decisionId: string
  ): Promise<SignalOutcomeRecord | null> {
    return this.fail();
  }
  async list(_userId: string, _limit?: number): Promise<SignalOutcomeRecord[]> {
    return this.fail();
  }
  async listAllPaginated(
    _userId: string,
    _pageSize?: number
  ): Promise<SignalOutcomeRecord[]> {
    return this.fail();
  }
  async listActive(_userId: string): Promise<SignalOutcomeRecord[]> {
    return this.fail();
  }
  async listActiveMatching(
    _userId: string,
    _match: ActiveMatchFilter
  ): Promise<SignalOutcomeRecord[]> {
    return this.fail();
  }
  async tryAcquireLease(
    _userId: string,
    _signalId: string,
    _ownerId: string,
    _leaseMs: number
  ): Promise<SignalOutcomeRecord | null> {
    return this.fail();
  }
  async applyBarAtomic(
    _userId: string,
    _signalId: string,
    _bar: SignalBarInput,
    _ownerId: string,
    _leaseMs?: number
  ): Promise<ApplyBarResult> {
    return this.fail();
  }
  async upsertDailyAggregateDelta(
    _userId: string,
    _day: string,
    _environment: "LIVE" | "TEST",
    _delta: Partial<SignalPerformanceDailyAggregate>
  ): Promise<void> {
    return this.fail();
  }
  async listDailyAggregates(_userId: string): Promise<SignalPerformanceDailyAggregate[]> {
    return this.fail();
  }
}
