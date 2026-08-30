import { describe, expect, it } from "vitest";

import {
  selectPOIFinalizationTarget,
  type SpentPOIStatusInfo,
} from "../src/railgun/poi-finalization.js";

const transactionHash = `0x${"12".repeat(32)}`;
const railgunTxid = "34".repeat(32);

const info = (
  overrides: Partial<SpentPOIStatusInfo["strings"]> = {},
): SpentPOIStatusInfo => ({
  strings: {
    txid: transactionHash,
    railgunTxid,
    poiStatusesSentCommitments: [{ list: "Missing" }],
    poiStatusesUnshieldEvents: [],
    listKeysCanGenerateSpentPOIs: ["list"],
    ...overrides,
  },
});

describe("PPOI finalization target selection", () => {
  it("derives the RAILGUN transaction and generation work from the mined hash", () => {
    expect(selectPOIFinalizationTarget([info()], transactionHash)).toEqual({
      railgunTxid,
      listKeysCanGenerate: ["list"],
      statuses: ["Missing"],
      acknowledged: false,
    });
  });

  it.each(["ProofSubmitted", "Valid"])(
    "treats %s output status as acknowledged",
    (status) => {
      expect(
        selectPOIFinalizationTarget(
          [
            info({
              poiStatusesSentCommitments: [{ list: status }],
              listKeysCanGenerateSpentPOIs: [],
            }),
          ],
          transactionHash,
        ).acknowledged,
      ).toBe(true);
    },
  );

  it("rejects an absent or ambiguous chain transaction mapping", () => {
    expect(() => selectPOIFinalizationTarget([], transactionHash)).toThrow(/not available/);
    expect(() =>
      selectPOIFinalizationTarget(
        [info(), info({ railgunTxid: "56".repeat(32) })],
        transactionHash,
      ),
    ).toThrow(/exactly one/);
  });
});
