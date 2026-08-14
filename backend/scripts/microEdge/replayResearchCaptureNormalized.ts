/**
 * CLI for offline corrected research replay. Never overwrites capture objects.
 */
import { basename, join } from "node:path";
import { replayResearchCaptureNormalized } from "../../src/services/microEdge/goldHunter/fast/research/researchCorrectedReplay";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf("--input");
  const outIdx = args.indexOf("--out");
  const inputDir = inputIdx >= 0 ? args[inputIdx + 1] : "";
  const outDir =
    outIdx >= 0
      ? args[outIdx + 1]!
      : join(process.cwd(), ".gold-hunter-data", "research-replay-corrected");
  if (!inputDir) {
    console.error("Usage: --input <capture-dir> [--out <dir>]");
    process.exit(2);
  }
  const result = await replayResearchCaptureNormalized({ inputDir, outDir });
  console.log(JSON.stringify({ ...result, inputDir, outDir: basename(outDir) }, null, 2));
}

void main();
