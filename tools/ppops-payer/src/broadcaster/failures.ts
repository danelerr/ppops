import { SafeFailure } from "../events.js";

export const BROADCASTER_REJECTION_CODES = [
  "BAD_TOKEN_FEE",
  "FAILED_QUORUM",
  "GAS_PRICE_TOO_LOW",
  "GAS_ESTIMATE_ERROR",
  "GAS_ESTIMATE_REVERT",
  "REJECTED_PACKAGED_FEE",
  "FAILED_TO_EXTRACT_PACKAGED_FEE",
  "BROADCASTER_OUT_OF_GAS",
  "POI_INVALID",
  "UNSUPPORTED_NETWORK",
  "MISSING_REQUIRED_FIELD",
  "NO_BROADCASTER_FEE",
] as const;

export type BroadcasterRejectionCode =
  (typeof BROADCASTER_REJECTION_CODES)[number];

export const BROADCASTER_AMBIGUITY_CODES = [
  "TRANSACTION_SEND_TIMEOUT",
  "TRANSACTION_SEND_RPC_ERROR",
  "REPEAT_TRANSACTION",
  "NOTE_ALREADY_SPENT",
  "TRANSACTION_UNDERPRICED",
  "NONCE_ALREADY_USED",
  "UNKNOWN_ERROR",
  "MISSING_RESPONSE",
  "BAD_RESPONSE",
  "WAKU_REQUEST_TIMEOUT",
  "INVALID_TRANSACTION_HASH",
  "UNCLASSIFIED_FAILURE",
] as const;

export type BroadcasterAmbiguityCode =
  (typeof BROADCASTER_AMBIGUITY_CODES)[number];

const DEFINITIVE_REJECTION_MESSAGES: ReadonlyMap<
  string,
  BroadcasterRejectionCode
> = new Map([
  ["Error: Bad token fee.", "BAD_TOKEN_FEE"],
  [
    "Error: Gas Price was rejected as too low to guarantee inclusion into the next block.",
    "FAILED_QUORUM",
  ],
  ["Error: Gas price rejected as too low.", "GAS_PRICE_TOO_LOW"],
  ["Error: Gas estimate error. Possible connection failure.", "GAS_ESTIMATE_ERROR"],
  [
    "Error: Gas estimate error. Possible connection failure. Please try again.",
    "GAS_ESTIMATE_REVERT",
  ],
  [
    "Error: Network Gas Price has changed dramatically and the Broadcaster Fee was rejected.",
    "REJECTED_PACKAGED_FEE",
  ],
  [
    "Error: Failed to extract Broadcaster Fee from transaction. Please try again.",
    "FAILED_TO_EXTRACT_PACKAGED_FEE",
  ],
  [
    "Error: Broadcaster is out of gas, or currently does not have enough to process this transaction.",
    "BROADCASTER_OUT_OF_GAS",
  ],
  [
    "Error: Could not validate Proof of Innocence - Broadcaster cannot process this transaction.",
    "POI_INVALID",
  ],
  ["Error: Broadcaster does not support this network.", "UNSUPPORTED_NETWORK"],
  ["Error: Missing required field.", "MISSING_REQUIRED_FIELD"],
  ["Error: No Broadcaster Fee included in transaction.", "NO_BROADCASTER_FEE"],
]);

const AMBIGUOUS_RESPONSE_MESSAGES: ReadonlyMap<
  string,
  BroadcasterAmbiguityCode
> = new Map([
  [
    "Error: WARNING: Timed out while sending to the blockchain. The transaction may be processing on-chain, but we can't find the receipt. This can occur when a Broadcaster has a connection issue. You will not see this transaction in your history, but your balance will reflect it if successful. We recommend waiting at least 15 minutes before trying again.",
    "TRANSACTION_SEND_TIMEOUT",
  ],
  [
    "Error: WARNING: Broadcaster received an error while sending the transaction, The transaction may still be processing on-chain, but we can't find the receipt. This can occur when a Broadcaster has a connection issue. Your balance should reflect it if successful.  We recommend waiting at least 15 minutes before trying again.",
    "TRANSACTION_SEND_RPC_ERROR",
  ],
  ["Error: Transaction has already been sent.", "REPEAT_TRANSACTION"],
  [
    "Error: ALREADY SPENT: One of the notes contained in this transaction have already been spent!",
    "NOTE_ALREADY_SPENT",
  ],
  [
    "Error: RPC Rejected Transction: Gas fee too low. Please select a higher gas price and resubmit.",
    "TRANSACTION_UNDERPRICED",
  ],
  [
    "Error: WARNING: Broadcaster recieved an error from the RPC: Nonce already used. There is no way to tell if the transaction made it. We did not recieve a tx hash. Please check the chain, if nothing happens within 15 minutes. It is safe to try again.",
    "NONCE_ALREADY_USED",
  ],
  ["Error: Unknown Broadcaster error.", "UNKNOWN_ERROR"],
  ["Error: RPC response is missing.", "MISSING_RESPONSE"],
  ["Error: Server responded 512. ", "BAD_RESPONSE"],
]);

const errorCause = (error: unknown): unknown =>
  error instanceof Error && "cause" in error ? error.cause : undefined;

export const classifyDefinitiveBroadcasterRejection = (
  error: unknown,
): BroadcasterRejectionCode | undefined => {
  if (
    !(error instanceof Error) ||
    String(error) !== "Error: Received response error from broadcaster."
  ) {
    return undefined;
  }
  const responseError = errorCause(error);
  if (!(responseError instanceof Error)) return undefined;
  return DEFINITIVE_REJECTION_MESSAGES.get(String(responseError));
};

export const classifyAmbiguousBroadcasterResponse = (
  error: unknown,
): BroadcasterAmbiguityCode | undefined => {
  if (error instanceof Error && String(error) === "Error: Request timed out.") {
    return "WAKU_REQUEST_TIMEOUT";
  }
  if (
    !(error instanceof Error) ||
    String(error) !== "Error: Received response error from broadcaster."
  ) {
    return undefined;
  }
  const responseError = errorCause(error);
  if (!(responseError instanceof Error)) return undefined;
  return AMBIGUOUS_RESPONSE_MESSAGES.get(String(responseError));
};

export class BroadcasterRejectedFailure extends SafeFailure {
  constructor(
    readonly rejectionCode: BroadcasterRejectionCode,
    options?: ErrorOptions,
  ) {
    super(
      "BROADCASTER_REJECTED",
      "Broadcaster explicitly rejected the transaction before submission",
      options,
    );
    this.name = "BroadcasterRejectedFailure";
  }
}

export class BroadcasterAmbiguousResponseFailure extends SafeFailure {
  constructor(
    readonly ambiguityCode: BroadcasterAmbiguityCode,
    options?: ErrorOptions,
  ) {
    super(
      "BROADCASTER_SUBMISSION_FAILED",
      "Broadcaster response does not prove whether submission reached the chain",
      options,
    );
    this.name = "BroadcasterAmbiguousResponseFailure";
  }
}
