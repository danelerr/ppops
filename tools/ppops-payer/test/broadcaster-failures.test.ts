import { describe, expect, it } from "vitest";

import {
  BroadcasterRejectedFailure,
  classifyAmbiguousBroadcasterResponse,
  classifyDefinitiveBroadcasterRejection,
} from "../src/broadcaster/failures.js";
import { BroadcasterSession } from "../src/broadcaster/session.js";

const responseError = (message: string): Error =>
  new Error("Received response error from broadcaster.", {
    cause: new Error(message),
  });

describe("Broadcaster submission failure classification", () => {
  it("classifies an authenticated pre-submission POI rejection", () => {
    expect(
      classifyDefinitiveBroadcasterRejection(
        responseError(
          "Could not validate Proof of Innocence - Broadcaster cannot process this transaction.",
        ),
      ),
    ).toBe("POI_INVALID");
  });

  it("does not classify chain-ambiguous Broadcaster responses as rejections", () => {
    const repeated = responseError("Transaction has already been sent.");
    expect(classifyDefinitiveBroadcasterRejection(repeated)).toBeUndefined();
    expect(classifyAmbiguousBroadcasterResponse(repeated)).toBe(
      "REPEAT_TRANSACTION",
    );
    expect(
      classifyDefinitiveBroadcasterRejection(new Error("Request timed out.")),
    ).toBeUndefined();
    expect(
      classifyAmbiguousBroadcasterResponse(new Error("Request timed out.")),
    ).toBe("WAKU_REQUEST_TIMEOUT");
  });

  it("carries only a stable rejection code into the safe failure", () => {
    const failure = new BroadcasterRejectedFailure("BAD_TOKEN_FEE");
    expect(failure).toMatchObject({
      code: "BROADCASTER_REJECTED",
      rejectionCode: "BAD_TOKEN_FEE",
    });
  });

  it("converts the SDK response into a classified safe failure", async () => {
    const session = new BroadcasterSession({} as never);
    await expect(
      session.submitPrepared({
        quote: {} as never,
        send: async () => {
          throw responseError("Bad token fee.");
        },
      }),
    ).rejects.toMatchObject({
      code: "BROADCASTER_REJECTED",
      rejectionCode: "BAD_TOKEN_FEE",
    });
  });

  it("keeps an authenticated but chain-uncertain response ambiguous", async () => {
    const session = new BroadcasterSession({} as never);
    await expect(
      session.submitPrepared({
        quote: {} as never,
        send: async () => {
          throw responseError("Transaction has already been sent.");
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "BROADCASTER_SUBMISSION_FAILED",
        ambiguityCode: "REPEAT_TRANSACTION",
      }),
    );
  });

  it("treats every unclassified post-send failure as ambiguous", async () => {
    const session = new BroadcasterSession({} as never);
    await expect(
      session.submitPrepared({
        quote: {} as never,
        send: async () => {
          throw new Error("unrecognized transport failure");
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "BROADCASTER_SUBMISSION_FAILED",
        ambiguityCode: "UNCLASSIFIED_FAILURE",
      }),
    );
  });

  it("treats a malformed returned hash as an ambiguous response", async () => {
    const session = new BroadcasterSession({} as never);
    await expect(
      session.submitPrepared({
        quote: {} as never,
        send: async () => "not-a-transaction-hash",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "BROADCASTER_SUBMISSION_FAILED",
        ambiguityCode: "INVALID_TRANSACTION_HASH",
      }),
    );
  });
});
