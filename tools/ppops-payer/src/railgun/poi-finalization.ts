type POIStatusRecord = Record<string, string> | undefined;

export type SpentPOIStatusInfo = {
  strings: {
    txid: string;
    railgunTxid: string;
    poiStatusesSentCommitments: POIStatusRecord[];
    poiStatusesUnshieldEvents: POIStatusRecord[];
    listKeysCanGenerateSpentPOIs: string[];
  };
};

export type POIFinalizationTarget = {
  railgunTxid: string;
  listKeysCanGenerate: string[];
  statuses: string[];
  acknowledged: boolean;
};

export class POIFinalizationNotReadyError extends Error {
  constructor() {
    super("The mined transaction is not available in the payer TXID history yet");
    this.name = "POIFinalizationNotReadyError";
  }
}

const normalizeTransactionHash = (value: string): string => {
  const lower = value.toLowerCase();
  return lower.startsWith("0x") ? lower : `0x${lower}`;
};

const normalizeRailgunTxid = (value: string): string =>
  value.toLowerCase().replace(/^0x/, "");

export const selectPOIFinalizationTarget = (
  statusInfos: SpentPOIStatusInfo[],
  transactionHash: string,
): POIFinalizationTarget => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new Error("Transaction hash is invalid");
  }
  const matches = statusInfos.filter(
    (info) => normalizeTransactionHash(info.strings.txid) === transactionHash.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new POIFinalizationNotReadyError();
  }

  const railgunTxids = [
    ...new Set(
      matches
        .map((info) => normalizeRailgunTxid(info.strings.railgunTxid))
        .filter((value) => /^[0-9a-f]{64}$/.test(value)),
    ),
  ];
  if (railgunTxids.length !== 1) {
    throw new Error("The chain transaction did not resolve to exactly one RAILGUN transaction");
  }

  const listKeysCanGenerate = [
    ...new Set(matches.flatMap((info) => info.strings.listKeysCanGenerateSpentPOIs)),
  ].sort();
  const statusRecords = matches.flatMap((info) => [
    ...info.strings.poiStatusesSentCommitments,
    ...info.strings.poiStatusesUnshieldEvents,
  ]);
  const statuses = statusRecords
    .flatMap((record) => (record ? Object.values(record) : []))
    .sort();
  const acknowledged =
    statusRecords.length > 0 &&
    statusRecords.every(
      (record) =>
        record !== undefined &&
        Object.keys(record).length > 0 &&
        Object.values(record).every(
          (status) => status === "ProofSubmitted" || status === "Valid",
        ),
    );

  return {
    railgunTxid: railgunTxids[0] as string,
    listKeysCanGenerate,
    statuses,
    acknowledged,
  };
};
