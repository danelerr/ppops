## `safeFailureResult` in `tools/ppops-payer/src/events.ts` (L61-L66)

**Purpose:** Defines the payer CLI's final error serialization boundary so caught
messages, stacks, causes, SDK objects and secret-bearing inputs are not included
in stdout failure JSON.

**Inputs & Assumptions:**

- `error` (`unknown`): any rejection reaching the final `main()` promise handler.
  Trust: untrusted runtime object, potentially originating in filesystem, SDK,
  RPC, Waku, parsing or project code.
- Implicit: JavaScript `instanceof SafeFailure` identity and the `code` property
  created by the exported class (L50-L59).
- Precondition: every CLI command rejection reaches the final promise rejection
  handler rather than being independently serialized. Established by `main()`
  dispatch and its terminal `.then(..., error => ...)` at
  `tools/ppops-payer/src/cli.ts:L1037-L1125`.
- Precondition: all project-created `SafeFailure.code` values belong to the
  compile-time union at L21-L48. Established by TypeScript checking for source
  callers; a runtime schema for directly constructed JavaScript instances is
  established by: **nothing found**.

**Outputs & Effects:**

- Returns exactly `{ ok: false, error: { code } }`.
- Preserves a recognized `SafeFailure` instance's code; maps every other value to
  `INTERNAL_ERROR`.
- Broadcaster rejection/ambiguity subclass fields do not cross this boundary;
  their stable details reach durable state/events through earlier Gate B logic.
- Does not read or return error name, message, stack, cause or arbitrary fields.
- Performs no I/O itself. The CLI subsequently serializes the result to stdout
  and exits with code 1.

---

**Block-by-Block:**

```ts
// L61-L66
export const safeFailureResult = (error: unknown) => ({
  ok: false,
  error: {
    code: error instanceof SafeFailure ? error.code : "INTERNAL_ERROR",
  },
});
```

- **What:** Reduces an arbitrary failure to one discriminator and fixed nesting.
- **Why here:** It runs after all Gate A/Gate B cleanup and is the only value sent
  to top-level failure output.
- **Assumes:** `instanceof` correctly identifies the local `SafeFailure` class;
  errors from another module copy/realm are intentionally classified as internal.
  Established by normal imports sharing this module instance.
- **Assumes:** A `SafeFailure` instance's runtime `code` is a permitted string.
  TypeScript source establishes this for compiled callers; runtime membership is
  established by: **nothing found**.
- **Establishes:** The returned object contains no caught message, stack, cause or
  other enumerable error data.
- **Depended on by:** Top-level stdout and automated/operator failure handling.

---

**Cross-Function Dependencies:**

- `SafeFailure` constructor (internal, L50-L59) stores stable code plus an Error
  message and optional cause; only code crosses this function.
- Caller final promise handler (internal) invokes `output(safeFailureResult(error))`
  and then closes stdout/stderr with exit code 1
  (`tools/ppops-payer/src/cli.ts:L1116-L1125`).
- Callee `output` (internal) JSON-stringifies the returned object and writes one
  stdout line (`tools/ppops-payer/src/cli.ts:L177-L179`).
- Separate `writeEvent` calls write selected progress/status fields to stderr
  before a final failure (`tools/ppops-payer/src/events.ts:L5-L19`). Their fields
  are outside the scope of `safeFailureResult` and are not retroactively changed
  by it.
- Gate B callers wrap Waku, journal, proof, RPC and receipt errors in
  `SafeFailure` before they reach this boundary
  (`tools/ppops-payer/src/broadcaster/session.ts:L480-L517`;
  `tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L191-L231`, `L246-L271`,
  `L345-L418`, `L441-L478`).

**Open Questions:**

- Are failure codes consumed as a closed runtime protocol by external automation,
  or only displayed to an operator?
- Should failures thrown by another installed copy/realm of `SafeFailure` be
  distinguishable from other internal errors? This source intentionally does not.
- Which stderr events are retained alongside failure JSON in production evidence,
  and what field policy governs those independent emissions?
