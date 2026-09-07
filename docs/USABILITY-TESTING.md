# Independent usability validation

Automated tests establish reproducibility, not that a new person understands the
product. Run this study before claiming independent usability or consumer-wallet
compatibility. No external participant results are claimed in this document.

## Participants and tasks

Recruit at least three developers who have not worked on PPOps. Give each the
same release archive and README. Observe without explaining the commands.

1. Explain what PPOps does and which host holds spending authority.
2. Start the wallet-free demo, create an order and observe one fulfillment.
3. Find the supported network/token, install path and payer requirements.
4. Integrate the merchant example and identify how retries preserve an order.
5. Diagnose a missing config file and an expired intent using the reported hint.
6. Explain what PARTIAL after expiry and a duplicate webhook mean.

For an independently authorized real pilot, separately record merchant setup,
initial synchronization, payer preparation, payment submission and confirmation.
Do not combine those times into an unsupported “fifteen-minute payment” claim.

## Record

Use participant pseudonyms. Record release/OS/Node, task completion, time,
documentation jumps, error codes, requests for help and the participant's own
description of the confusing step. Never collect keys, provider credentials,
request URLs, payment identifiers or commercial data.

## Acceptance targets

- Every participant completes the local demo without editing source or acquiring
  blockchain credentials.
- At least two of three complete the integration exercise without maintainer
  intervention and correctly explain idempotency and fulfillment.
- Everyone distinguishes a simulation, a detected transfer and a confirmed payment.
- Each setup failure has a documented corrective path that the participant can find.
- Real scan/payment latency is reported as observations with versions and conditions,
  not guaranteed by a passing local test.

Log failures as concrete product work, then rerun the failed task with a fresh
participant after correcting it. The [external pilot runbook](EXTERNAL-PILOT.md)
provides the checklist for external testing.

## PayIn payer cohort (beta.3 UX)

Separately recruit at least five consenting payers who already have spendable
private liquidity. Real-value testing requires its own explicit authorization,
amount limits and recovery plan; the wallet-free demo does not establish these results.
Use the exact source commit, wallet version, network and request workflow under test.

Ask participants to open a request, verify whom they intend to pay, inspect their
readiness, review the fee, authorize once and recognize completion. Also show
pending-balance, insufficient-balance, partial, late, expired and interrupted
connection scenarios. Prefer synthetic scenarios for error-comprehension exercises.

Targets, not results:

- At most three primary actions: open request → Pay → Confirm.
- Under 60 seconds to submission for an already-ready payer, not to final acceptance.
- At least 80% complete without assistance.
- At least 80% correctly explain why an unready payment cannot proceed.
- Zero RAILGUN concepts required in the happy path. Count terminology the participant
  must understand, including any CLI/runbook detours, not just text hidden by the page.

The current reference-payer setup still has technical steps. Do not report the
three-action target as achieved by counting only checkout clicks. Record wallet
handoff failures separately from readiness, submission, finality and privacy-check
latency. Do not introduce telemetry or session replay to measure these targets.
