## `verifySignedDescriptor` in `src/security/descriptor.ts` (L95-L111)

**Purpose:** Establishes descriptor authenticity against an address obtained
independently of the descriptor itself. The payer package contains a structurally
equivalent verifier at `tools/ppops-payer/src/descriptor.ts:L54-L73`.

**Inputs & Assumptions:**

- `descriptor`: untrusted structured data at API/CLI boundaries; schema parsing
  occurs inside this function (`L99-L100`).
- `expectedSigner`: semi-trusted caller input. It must come from an independent
  merchant identity channel; provenance is established by: **nothing found** in
  either verifier.
- Implicit: ethers EIP-712 encoding/recovery and the fixed domain/type schema at
  `src/security/descriptor.ts:L12-L28`, mirrored at payer `L5-L21`.
  Established by: pinned ethers behavior and the two current definitions.

**Outputs & Effects:**

- Returns the recovered signer address when the embedded signer and recovered
  signer both equal `expectedSigner` after checksum normalization.
- Throws for malformed schema, invalid signature, invalid expected address, or
  signer mismatch.
- No durable state or network effect.
- Does not itself check expiry or instance/request field equality; callers add
  those checks.

---

**Block-by-Block:**

```ts
// L99-L106
const parsed = parseSignedDescriptor(descriptor);
const { signature, ...payload } = parsed;
const recovered = verifyTypedData(domainFor(payload.chainId),
  PAYMENT_DESCRIPTOR_TYPES, payload, signature);
```

- **What:** Strictly parses all signed fields and recovers an EVM address from
  the typed-data signature.
- **Why here:** Recovery only operates on the canonical parsed payload.
- **Assumes:** Root and payer type/domain definitions remain byte-for-byte
  compatible. Established by: current source parity at the cited definitions;
  an automated shared-schema equivalence check is established by: **nothing
  found**.
- **Establishes:** `recovered` is the signer recognized by ethers for this exact
  typed payload/signature.
- **Depended on by:** Both signer comparisons and all request/intent verification.

```ts
// L107-L110
const trustedSigner = getAddress(expectedSigner);
if (getAddress(payload.merchantSigner) !== trustedSigner ||
    getAddress(recovered) !== trustedSigner) throw ...;
```

- **What:** Requires both the payload claim and cryptographic recovery to match
  the separately supplied trust root.
- **Why here:** Prevents the descriptor from choosing its own accepted identity.
- **Assumes:** `expectedSigner` was obtained independently; **nothing found** in
  this function establishes its provenance.
- **Establishes:** Embedded, recovered, and expected addresses are identical.
- **Depended on by:** `IntentService.createRecord/verifyDescriptor`, descriptor
  CLI/API verification, mainnet gate, and payer `verifyPaymentRequest`.

---

**Cross-Function Dependencies:**

- Callee `parseSignedDescriptor` (internal): strict Zod schema limits numbers,
  amounts, bytes, signer/address and signature formats (`L30-L51`).
- Callee `verifyTypedData` / `getAddress` (external-source-available dependency):
  EIP-712 recovery and EVM normalization.
- Root callers add different semantics:
  - `IntentService.createRecord` verifies newly produced output (`src/intents/service.ts:L107-L120`).
  - `IntentService.verifyDescriptor` also checks runtime profile and expiry
    (`src/intents/service.ts:L184-L198`).
  - payer `verifyPaymentRequest` checks current request state and every duplicated
    payment field (`tools/ppops-payer/src/request.ts:L51-L93`).
- Invariant coupling: root and payer independently define the same domain and
  field order. No generated shared schema enforces that they remain aligned.

**Open Questions:**

- What process distributes, pins, and rotates `expectedSigner` for real payers?
- Whether a future descriptor version will be supported concurrently is not
  represented; both schemas currently accept only literal version 1.
