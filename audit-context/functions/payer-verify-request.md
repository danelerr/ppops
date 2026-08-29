## `verifyPaymentRequest` in `tools/ppops-payer/src/request.ts` (L51-L94)

**Purpose:** Converts untrusted payer-facing JSON into an executable Gate A
request only after authenticating the descriptor against an out-of-band signer
and checking every unsigned duplicate field against the pinned profile/signed
payload.

**Inputs & Assumptions:**

- `value`: untrusted JSON loaded from HTTPS/loopback HTTP or a local file.
- `expectedSigner`: semi-trusted CLI input whose independent provenance is
  outside the request.
- `nowSeconds`: trusted process clock by default.
- Precondition: remote response/file is at most 64 KiB and valid JSON.
  Established by `loadPaymentRequest` helpers (`L96-L148`).
- Precondition: expected signer is distributed independently. Established by:
  **nothing found** in code.

**Outputs & Effects:**

- Returns a strictly parsed `PaymentRequest` only for an open, unreceived,
  unexpired native-Arbitrum-USDC request whose duplicated fields exactly match
  the signed descriptor and pinned expected signer.
- Throws on all mismatches; no state or network effect in this function.
- Does not reserve the intent or make it immutable after return.

---

**Block-by-Block:**

```ts
// L56-L58
const request = PaymentRequestSchema.parse(value);
verifySignedDescriptor(request.descriptor, expectedSigner);
const descriptor = request.descriptor;
```

- **What:** Strictly validates the full envelope and authenticates signed fields.
- **Why here:** No business comparison operates on unparsed/unauthenticated data.
- **Assumes:** Duplicated root/payer EIP-712 definitions remain aligned.
  Established by: current source parity; an automated equivalence guarantee is
  established by: **nothing found**.
- **Establishes:** Descriptor embedded and recovered signers equal the independently
  supplied signer (`tools/ppops-payer/src/descriptor.ts:L54-L73`).
- **Depended on by:** All later request field comparisons and spend command.

```ts
// L59-L63
assertSame(request.status === "OPEN", ...);
assertSame(received === "0", ...);
assertSame(pending === "0", ...);
assertSame(request.expiresAt > nowSeconds, ...);
assertSame(descriptor.expiresAt === request.expiresAt, ...);
```

- **What:** Admits only an unused/current intent at verification time.
- **Why here:** Gate A is defined as one exact fresh payment request.
- **Assumes:** Merchant status and received/pending totals remain unchanged until
  later send. Established by: **nothing found**; payer CLI does not refetch
  after engine sync/proof, although the spend path rechecks expiry locally.
- **Establishes:** The returned snapshot was open, empty, and unexpired at
  verification time.
- **Depended on by:** Operator confirmation and amount spend path.

```ts
// L64-L83
/* fixed chain, token, symbol/decimals, amount and formatted amount comparisons */
```

- **What:** Requires pinned Arbitrum/native-USDC profile and signed/exposed amount
  equality.
- **Why here:** Unsigned presentation fields cannot redirect token/value.
- **Assumes:** Hard-coded address/decimals constants identify the intended asset
  (`tools/ppops-payer/src/constants.ts:L7-L20`). Established by: the fixed Gate A
  product profile encoded there.
- **Establishes:** Executed ERC-20 recipient amount can be sourced from the
  verified request without trusting presentation text.
- **Depended on by:** `sendSelfSignedTransfer` amount/token construction.

```ts
// L84-L92
assertSame(descriptor.recipient0zk === request.recipient, ...);
assertSame(request.memo.toLowerCase() === `ppops:v1:${descriptor.reference...}`, ...);
assertSame(getAddress(request.expectedMerchantSigner) === getAddress(expectedSigner), ...);
```

- **What:** Binds exact receiver and memo to signed data and cross-checks the
  checkout's signer hint against the external signer.
- **Why here:** Prevents unsigned root-envelope substitution.
- **Assumes:** RAILGUN address validation in the Zod schema correctly recognizes
  the network/address format. Established by: the external SDK validator used at
  `L35-L38`.
- **Establishes:** Recipient/memo/profile/signature are mutually consistent.
- **Depended on by:** Proof generation.

---

**Cross-Function Dependencies:**

- Callee `PaymentRequestSchema` (internal): strict shape, numeric grammar, valid
  0zk address and memo grammar (`L21-L43`).
- Callee payer `verifySignedDescriptor` (internal): EIP-712 recovery and external
  signer equality.
- Caller `verifiedRequest` wraps any error into a fixed `REQUEST_INVALID` public
  failure (`tools/ppops-payer/src/cli.ts:L286-L296`); both `request-verify` and
  `pay-self-signed` use it.
- Shared invariant: descriptor is signed but request status/received/pending and
  formatted amount are live envelope fields; they are explicitly compared or
  constrained here.

**Open Questions:**

- A local submission journal reserves the intent immediately before send, but
  the merchant intent itself is not remotely reserved or reloaded after this
  verification.
- Expected-signer distribution/rotation is outside this package.
