## `deriveProjection` in `src/reconciliation/projection.ts` (L50-L78)

**Purpose:** Purely derives one intent's externally visible accounting/status
from its complete persisted settlement set and previous revision.

**Inputs & Assumptions:**

- `intent`: trusted persisted intent.
- `settlements`: trusted persisted rows for that intent; caller obtains them by
  `intent_id` (`src/db/database.ts:L428-L434`).
- `previous`: trusted existing projection paired to the same intent.
- `now`: process time, injected by caller.
- Precondition: all amount strings parse as nonnegative decimal `bigint`.
  Intent creation/scanner establish product-path values; row deserialization does
  not revalidate them. Established for product callers by the intent/scanner
  grammars; for arbitrary direct callers: **nothing found** here.
- Precondition: each supplied settlement belongs to `intent.id`. Established by
  caller query at `src/db/database.ts:L428-L434`, not checked here.

**Outputs & Effects:**

- Returns a new projection with revision incremented by exactly one and
  `updatedAt = now` if status or any amount changes.
- Returns the identical previous object when no observable projection field
  changes.
- No I/O or state mutation.

---

**Block-by-Block:**

```ts
// L56-L60
const creditable = settlements.filter(isCreditable);
const pending = settlements.filter(isPending);
const received = addAmounts(creditable);
const pendingAmount = addAmounts(pending);
const expected = BigInt(intent.expectedAmountAtomic);
```

- **What:** Separates credited from pending matched value and sums with `bigint`.
- **Why here:** Status and overpayment derive from these totals.
- **Assumes:** No duplicate economic note appears under two settlement IDs. The
  stable-ID/DB constraints establish note-coordinate uniqueness within the
  modeled identity (`src/db/database.ts:L188-L210`).
  Established by: that primary/unique-key model plus scanner identity creation.
- **Establishes:** `received` includes only `MATCHED + FINALIZED + SPENDABLE`;
  `pending` excludes `REVERTED` and all creditable notes (`L8-L19`).
- **Depended on by:** Status, overpayment, API/webhook values.

```ts
// L61-L69
const next = {
  intentId: intent.id,
  status: statusFor(...),
  receivedAmountAtomic: received.toString(),
  pendingAmountAtomic: pendingAmount.toString(),
  overpaymentAmountAtomic: received > expected ? ... : "0",
  revision: previous.revision,
  updatedAt: previous.updatedAt,
};
```

- **What:** Builds the candidate projection.
- **Why here:** Keeps revision/timestamp stable until an actual change is known.
- **Assumes:** `statusFor` crossing order by block/tree/position represents
  payment chronology; timestamp comes from quorum block data
  (`L21-L47`, scanner `L179-L205`). Established by: scanner/RPC normalization
  on product paths; SDK coordinate ordering remains an external contract.
- **Establishes:** Overpayment is never negative; all totals are canonical
  decimal strings.
- **Depended on by:** Change detection.

```ts
// L70-L77
const changed = /* status or amount differs */;
return changed ? { ...next, revision: previous.revision + 1, updatedAt: now }
  : previous;
```

- **What:** Converts observable projection change into one revision transition.
- **Why here:** Outbox dedupe keys use the resulting revision.
- **Assumes:** Revision is a safe integer over system lifetime; an explicit upper
  bound is established by: **nothing found**.
- **Establishes:** No-op rediscovery does not change revision or timestamp.
- **Depended on by:** `transitionEventType`, event ID/dedupe construction,
  restart idempotency.

---

**Cross-Function Dependencies:**

- Internal `isCreditable`, `isPending`, `addAmounts`, and `statusFor` at L8-L48.
- Caller `ReconciliationService.rebuildProjection` persists only a changed
  revision and queues at most one transition event (`src/reconciliation/service.ts:L106-L125`).
- Shared invariant: projection is a cache/derivation; settlements are the source
  for recalculation.

**Open Questions:**

- Desired ordering if multiple crossing settlements share the same block/tree/
  position cannot arise under modeled identity, but SDK coordinate guarantees
  are external.
