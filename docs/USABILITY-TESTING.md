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
participant after correcting it. The [external pilot](EXTERNAL-PILOT.md) remains
the separate gate for real independent merchant adoption.
