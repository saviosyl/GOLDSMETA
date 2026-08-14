import { mkdirSync, writeFileSync } from "node:fs";
import { replayResearchCaptureDepthBookCorrected } from "../../src/services/microEdge/goldHunter/fast/research/researchCorrectedReplay";

async function main(): Promise<void> {
  const input = process.argv[2] ?? "/tmp/gh-mst6992t-raw";
  const out =
    process.argv[3] ?? "/tmp/gh-depth-corrected-v1/gh_research_mst6992t_ug7ykh";
  mkdirSync(out, { recursive: true });
  const r = await replayResearchCaptureDepthBookCorrected({
    inputDir: input,
    outDir: out
  });
  writeFileSync(`${out}/result.json`, JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
