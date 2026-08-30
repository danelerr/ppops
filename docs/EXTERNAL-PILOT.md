# Independent operator pilot

Status: **OPEN — no independent operator has completed this gate yet.**

Project release status on 2026-08-30: public `main` and its verify/Docker CI
pass at `9374f5d`; the versioned beta tag and release assets remain pending.

This runbook turns the remaining adoption requirement into a reproducible,
privacy-preserving test. It does not ask an operator to disclose a mnemonic,
viewing key, wallet database, payer address, transaction hash, memo/reference or
invoice identifier.

The strongest pilot is an independently controlled merchant installation. A
separately controlled payer is also useful, but must be described as payer
validation rather than merchant adoption.

## Choose one role

### Track A — independent merchant

The external operator runs PPOps on infrastructure they control, imports only
their merchant wallet's shareable viewing key, creates the intent and receives
the webhook. A separate payer completes the RAILGUN payment. The merchant keeps
its spending wallet off the PPOps host.

This track can satisfy the independent-deployment evidence gate when the
operator completes the signed Mainnet Gate report and provides genuine product
feedback.

### Track B — independent payer

The external operator runs only `tools/ppops-payer` on a machine they control.
They obtain the payment request and expected merchant signer through separate
authenticated channels, prepare the transfer, select their own amount/fee
ceilings and submit only after inspecting the no-send result.

This track proves that a third party can consume a PPOps request without
sharing spending authority. It does not by itself prove an independent merchant
deployment.

## Safety rules

1. Use a dedicated pilot wallet and the minimum amount the operator accepts.
2. Never send wallet secrets to the PPOps maintainer, merchant, GitHub, a form,
   chat or evidence archive.
3. Run merchant and payer tooling in their documented separate trust domains.
4. Verify the merchant signer independently of the checkout URL.
5. Treat `prepare-*` as non-financial evidence only. It never authorizes the
   corresponding `pay-*` command.
6. For Broadcaster mode, approve the payment amount and maximum atomic-USDC fee
   separately. A fee quote can change; exceeding either ceiling must fail
   without submission. The no-send result must also report a strict majority of
   configured RPCs for the exact final populated-calldata simulation and must
   not report `SUBMISSION_ALREADY_RECORDED` for an input held by another intent.
7. Recover every ambiguous submission first. Retry only when the journal-backed
   `retry-broadcaster` command reports it available; it preserves the exact
   nullifier set, excludes attempted Broadcaster identities and stops after
   three retry reservations. Never delete or edit the journal to create a fresh
   spend.
8. Publish only redacted evidence. Keep direct payment identifiers private
   unless the operator consciously accepts correlation loss.

## Reproduce the release

The maintainer must first push a public commit, wait for CI to pass and publish
a version-matching release tag. The release attaches its immutable container
digest, merchant/payer SBOMs and public gate reports. An unpushed local commit
is not reproducible external evidence.

Use the exact release tag or commit supplied for the pilot:

```bash
git clone https://github.com/danelerr/ppops.git
cd ppops
git checkout RELEASE_TAG_OR_COMMIT
npm ci
npm run payer:install
npm run verify:all
git status --short
```

Use Node.js 22 or newer; the release CI uses the pinned Node 24 version. Record
the exact commit and whether all checks passed. `git status --short` must print
nothing. Do not continue with funds if the checked-out tree is dirty or
verification fails.

Track A follows [the controlled pilot guide](PILOT-GUIDE.md) and
[Mainnet Gate](MAINNET-GATE.md). Track B follows the payer
[Gate B runbook](../tools/ppops-payer/docs/GATE-B.md). The operator chooses all
financial bounds; the repository's historical measurements are not quotes or
recommendations.

## Evidence package

An acceptable evidence package contains:

- exact PPOps tag/commit and installation method;
- operator role: independent merchant or independent payer;
- Arbitrum One (`42161`) and native-USDC token identity;
- pass/fail for install, verification, request verification, preparation,
  submission, payer PPOI completion and PPOps reconciliation;
- for Track A, the metadata-minimal signed
  `artifacts/mainnet-gate-report.json` and successful report-verification output;
- confirmation that merchant and payer secrets remained in their respective
  trust domains;
- measured onboarding/payment time, Broadcaster fee, failures and manual steps,
  retained privately when their combination could identify the payment;
- at least one paragraph of candid operator feedback and whether they would run
  PPOps again.

For a Track A report, verify the merchant signature using the signer obtained
outside checkout, then calculate a digest without printing the report contents:

```bash
node dist/cli.js mainnet-gate-report-verify \
  --file ./artifacts/mainnet-gate-report.json \
  --expected-signer PINNED_MERCHANT_SIGNER

shasum -a 256 ./artifacts/mainnet-gate-report.json
```

Linux operators may use `sha256sum` for the second command.

The public statement should omit addresses, transaction hashes, RAILGUN TXIDs,
references, invoice IDs and exact timestamps/amounts when those would enable
correlation. An established public account can publish the release commit,
report digest and pass/fail statement; the merchant report signature remains
verifiable without exposing its API token or wallet credential. A private
reviewer may inspect stronger evidence under an explicit confidentiality
agreement.

Suggested public statement:

```text
I independently operated the [merchant/payer] side of PPOps at commit <commit>
on Arbitrum One. I controlled my own infrastructure and wallet credentials and
did not provide them to the maintainer. The payment [did/did not] reach PPOps
FINALIZED + SPENDABLE + MATCHED -> PAID. I verified the published report digest
<digest>. Direct payment identifiers are intentionally omitted.
```

## Definition of done

The adoption gate passes only when all of these are true:

- an operator outside the maintainer's control ran one documented track;
- at least one real payment reached
  `FINALIZED + SPENDABLE + MATCHED -> PAID`;
- any ambiguous state was resolved without a blind retry;
- the evidence is tied to an exact public commit/release;
- the operator's existence and statement are independently verifiable;
- direct payment metadata and wallet secrets were not published;
- failures and negative feedback are retained rather than omitted.

A maintainer-run second wallet, another local process or an unsigned testimonial
does not satisfy this gate.
