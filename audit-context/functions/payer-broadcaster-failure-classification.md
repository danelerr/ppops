## Broadcaster response classifiers in `tools/ppops-payer/src/broadcaster/failures.ts` (L3-L165)

**Purpose:** Converts selected installed-SDK response-error strings into bounded
project categories and carries those categories through `SafeFailure` subclasses
without exposing raw Broadcaster text at the CLI failure boundary.

**Inputs & Assumptions:**

- `error` (`unknown`): caught result of `BroadcasterTransaction.send`, normally
  wrapped by the installed SDK as an outer `Error` with a cause `Error` built from
  decrypted `response.error`.
- Two exact maps: 12 rejection categories at L39-L73 and nine mapped ambiguity
  response categories at L75-L103. The ambiguity enum also contains
  `WAKU_REQUEST_TIMEOUT`, `INVALID_TRANSACTION_HASH` and
  `UNCLASSIFIED_FAILURE` for project-side outcomes.
- Precondition: outer string is exactly
  `Error: Received response error from broadcaster.` and nested cause is an
  `Error`, except the dedicated exact local timeout admitted by the ambiguity
  classifier. Established by the guards at L108-L136.
- Precondition: SDK/Broadcaster message spelling and punctuation match the map.
  Installed implementation establishes the outer/cause construction at
  `tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L136-L141`; version-stable inner
  vocabulary is established by: **nothing found** in project source.
- Implicit: response decryption/authentication semantics of the Wallet SDK. The
  installed response handler obtains raw `response.error` from a decrypted
  object; its schema/authenticity contract is external.

**Outputs & Effects:**

- `classifyDefinitiveBroadcasterRejection` returns one rejection enum or
  `undefined`.
- `classifyAmbiguousBroadcasterResponse` returns one ambiguity enum or
  `undefined`.
- `BroadcasterRejectedFailure` carries top-level code `BROADCASTER_REJECTED` plus
  `rejectionCode`.
- `BroadcasterAmbiguousResponseFailure` carries top-level code
  `BROADCASTER_SUBMISSION_FAILED` plus `ambiguityCode`, including the explicit
  `UNCLASSIFIED_FAILURE` fallback constructed by `submitPrepared`.
- No function logs, persists, submits or mutates remote state.

---

**Block-by-Block:**

```ts
// L3-L103
BROADCASTER_REJECTION_CODES = [...12 values...];
BROADCASTER_AMBIGUITY_CODES = [...12 values, including local timeout,
  invalid hash and UNCLASSIFIED_FAILURE...];
DEFINITIVE_REJECTION_MESSAGES = new Map(exact String(error) -> code);
AMBIGUOUS_RESPONSE_MESSAGES = new Map(exact String(error) -> code);
```

- **What:** Declares the durable vocabulary and exact installed-response mapping.
- **Why here:** Journal and event output store stable short categories rather
  than dependency-owned prose.
- **Assumes:** Each inner message has the category semantics assigned by its map.
  The mapping is established as project policy here; remote non-submission or
  chain-uncertainty semantics are established by: **nothing found** in this file.
- **Establishes:** The only category strings accepted by journal schema and
  subclass types.
- **Depended on by:** Both classifier functions, journal schema and status output.

```ts
// L105-L137
if (error is exactly "Request timed out.") return WAKU_REQUEST_TIMEOUT;
if (!(error instanceof Error) || String(error) !== expectedOuter) return undefined;
const responseError = errorCause(error);
if (!(responseError instanceof Error)) return undefined;
return selectedMap.get(String(responseError));
```

- **What:** Admits only one nested error shape and exact map hit.
- **Why here:** Arbitrary errors, local timeouts and unrecognized response text
  return undefined from these exact classifiers; the local SDK timeout is
  explicitly `WAKU_REQUEST_TIMEOUT`, while `submitPrepared` assigns the stable
  `UNCLASSIFIED_FAILURE` ambiguity to otherwise unmatched post-send failures.
- **Assumes:** `String(Error)` preserves the exact prefix/message used in map
  keys. Established by JavaScript `Error` behavior relied on at L112/L118 and
  L125/L130; cross-realm error identity is established by: **nothing found**.
- **Establishes:** No substring/regex/heuristic classification; failure to match
  returns `undefined`.
- **Depended on by:** `BroadcasterSession.submitPrepared` fallback order.

```ts
// L139-L165
class BroadcasterRejectedFailure extends SafeFailure { ... }
class BroadcasterAmbiguousResponseFailure extends SafeFailure { ... }
```

- **What:** Attaches the stable detail enum to one of two safe top-level codes.
- **Why here:** `sendBroadcasterTransfer` uses subclass identity to select the
  matching journal transition while top-level failure JSON emits only code.
- **Assumes:** One module instance preserves `instanceof` identity between
  session and transfer modules. Established by their normal imports; alternate
  module copies/realms are established by: **nothing found**.
- **Establishes:** Every constructed subclass contains a typed detail category,
  safe code, fixed project message and optional internal cause.
- **Depended on by:** Journal rejection/ambiguity recording and
  `safeFailureResult`.

---

**Cross-Function Dependencies:**

- Installed SDK creates the inspected outer/cause pair from decrypted
  `response.error`
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/transact/broadcaster-transaction.js:L136-L141`).
- `BroadcasterSession.submitPrepared` invokes rejection classifier first,
  ambiguity classifier second and generic fallback last
  (`tools/ppops-payer/src/broadcaster/session.ts:L480-L517`).
- `sendBroadcasterTransfer` branches on subclass identity and writes only stable
  categories into the journal/events
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L357-L406`).
- `SubmissionJournal` imports both enum arrays into strict Zod schemas
  (`tools/ppops-payer/src/security/submission-journal.ts:L9-L25`).
- `safeFailureResult` emits the inherited top-level code, not the detail field
  (`tools/ppops-payer/src/events.ts:L50-L66`).

**Open Questions:**

- Where is the Broadcaster protocol contract for each mapped inner message and
  its non-submission/uncertainty meaning?
- Are these exact response strings stable across every Broadcaster version
  accepted by `broadcasterVersionRange`?
- Are response errors always native `Error` instances in the CLI's module realm?
- Which operator evidence distinguishes causes grouped into
  `UNCLASSIFIED_FAILURE`, such as an unrecognized encrypted response error or
  another unmatched failure after `send()` began?
