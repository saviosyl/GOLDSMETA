import type { MicroModel } from "./modelInterface";

/** Model B — tree/GBM challenger interface only (not auto-promoted). */
export type MicroChallengerModel = MicroModel & {
  kind: "TREE_GBM_CHALLENGER";
  promoted: false;
};

/** Model C — sequence model placeholder. */
export type MicroSequenceModelPlaceholder = {
  kind: "SEQUENCE_PLACEHOLDER";
  implemented: false;
  version: "sequence-placeholder-v0";
};

export const sequenceModelPlaceholder: MicroSequenceModelPlaceholder = {
  kind: "SEQUENCE_PLACEHOLDER",
  implemented: false,
  version: "sequence-placeholder-v0"
};
