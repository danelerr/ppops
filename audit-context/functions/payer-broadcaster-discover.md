## `BroadcasterSession.discover` in `tools/ppops-payer/src/broadcaster/session.ts` (L341-L398)

**Purpose:** Selects a currently valid, peer-reachable Broadcaster quote before
proof generation. On same-nullifier retry it excludes the original and every
previously attempted Broadcaster 0zk identity.

**Inputs & Assumptions:**

- `excludedRailgunAddresses`: zero or more addresses constructed by
  `sendBroadcasterTransfer` from the original record plus all retry attempts
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L138-L178`).
- Started Waku client, cached native-USDC fee messages, configured reliability/
  lifetime/discovery bounds and current system time.
- Implicit: trusted-fee-signer verification and cache population by the installed
  SDK, and LightPush/Filter peer counts as current network-readiness signals.
- Precondition: a distinct 0zk address denotes a distinct Broadcaster identity.
  String identity is established by lowercased address comparison; operational
  independence is established by: **nothing found** in project source.
- Precondition: excluding a prior identity before regenerating proof is the
  intended retry-diversity rule. Established by standard caller dataflow; direct
  callers may pass any exclusion list.

**Outputs & Effects:**

- Returns one validated quote whose Broadcaster address is absent from the
  exclusion set and only while both LightPush and Filter peer counts are nonzero.
- Candidate order is deterministic over the current array after validation:
  lowest fee-per-gas, then highest reliability, then fingerprint.
- Emits summary counts only when they change, then emits selected quote metrics;
  it does not emit Broadcaster addresses.
- Polls once per second until the configured deadline; then rejects with
  `BROADCASTER_UNAVAILABLE`.
- Performs no proof generation, journal write or Waku transaction submission.

---

**Block-by-Block:**

```ts
// L196-L260 helper call chain
validate every candidate, ignoring SafeFailure-invalid quotes;
excluded = lowercased input addresses;
count unique/excluded/eligible Broadcaster identities;
eligibleCandidates = candidates whose address is not excluded;
selected = sort by feePerUnitGas asc, reliability desc, fingerprint asc)[0];
```

- **What:** Converts untyped cache results into one selected quote plus aggregate
  identity counts.
- **Why here:** Retry exclusion and deterministic economics precede proof work.
- **Assumes:** `validateBroadcaster` fully captures local quote admission.
  Established at L87-L148; fee-message signature/provenance remains an installed
  SDK dependency.
- **Assumes:** Multiple valid quotes from one 0zk identity may remain separate
  selection candidates while unique counts deduplicate only metrics. Established
  by candidate-array sorting at L243-L259; a one-quote-per-identity contract is
  established by: **nothing found**.
- **Establishes:** Returned `selected`, if defined, is valid and not excluded;
  counts distinguish quotes, unique identities and eligible identities.
- **Depended on by:** Polling method and operational discovery events.

```ts
// L341-L398
while (Date.now() < deadline) {
  candidates = findBroadcastersForToken(...);
  discovery = selectDiscoverableBroadcaster(candidates, bounds, exclusions);
  emit changed summary;
  if (discovery.selected && lightPush > 0 && filter > 0) return selected;
  await delay(1000);
}
throw BROADCASTER_UNAVAILABLE;
```

- **What:** Repeats selection against current cache and gates return on transport
  peer availability.
- **Why here:** A valid quote alone does not begin proof unless the client also
  reports send/response peer paths.
- **Assumes:** Nonzero peer counts predict usable LightPush and Filter behavior.
  The numeric checks are established at L375-L390; end-to-end Waku delivery is
  established by: **nothing found** in this method.
- **Establishes:** Success returns before the deadline with one eligible quote
  and nonzero peer counts observed in that iteration; failure has no durable
  attempt mutation.
- **Depended on by:** Gas estimation, fee calculation, proof recipient and later
  quote revalidation.

---

**Cross-Function Dependencies:**

- `validateBroadcaster` enforces token, address, fee ID/range, availability,
  reliability and quote lifetime (`tools/ppops-payer/src/broadcaster/session.ts:L87-L148`).
- `selectDiscoverableBroadcaster` owns exclusion/counting/order policy
  (`tools/ppops-payer/src/broadcaster/session.ts:L196-L260`).
- `peerCounts` reads Waku mesh/pubsub/lightpush/filter counts
  (`tools/ppops-payer/src/broadcaster/session.ts:L400-L412`).
- `sendBroadcasterTransfer` supplies the historical-address exclusions and uses
  the returned address as fee recipient before proof
  (`tools/ppops-payer/src/railgun/broadcaster-transfer.ts:L138-L178`,
  `L218-L266`).
- Installed SDK fee handling verifies/parses cached fee messages under its global
  configuration
  (`tools/ppops-payer/node_modules/@railgun-community/waku-broadcaster-client-node/dist/fees/handle-fees-message.js:L32-L128`).

**Open Questions:**

- Do distinct Broadcaster 0zk addresses imply distinct operators, infrastructure
  or failure domains?
- Can one Broadcaster publish several valid quotes, and which quote-level versus
  identity-level selection semantics are intended?
- Are nonzero LightPush/Filter peer counts sufficient readiness evidence for the
  configured Waku route at proof time?
- When every eligible identity is excluded, is discovery timeout the intended
  operator signal even if the journal's numeric retry limit is not yet reached?
