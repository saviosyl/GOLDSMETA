/**
 * Research event collector — hot path enqueues into durable sink only.
 */
import type { ResearchCaptureRecord } from "./researchTypes";
import type { ResearchDurableSink } from "./researchDurableSink";
import { assertNoExecutionAdapterArgument } from "./nullExecutionGuard";

export class ResearchEventCollector {
  private records = 0;

  constructor(
    readonly sink: ResearchDurableSink,
    opts?: { _executionAdapterMustBeUndefined?: unknown }
  ) {
    assertNoExecutionAdapterArgument(opts?._executionAdapterMustBeUndefined);
  }

  record(rec: ResearchCaptureRecord): boolean {
    this.records += 1;
    return this.sink.enqueue(rec);
  }

  count(): number {
    return this.records;
  }

  flush(): void {
    this.sink.flush();
  }

  async flushAndWait(timeoutMs = 10_000): Promise<void> {
    await this.sink.flushAndWait(timeoutMs);
  }
}
