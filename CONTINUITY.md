# ETHOnline 2026 Continuity

WORK_BASE_SHA: `cfc3d408175236a56410cbfe6ef7e4e4f95018f1` (7 September 2026).
PRE_EVENT_SHA: pending final confirmation; candidate
`f0f4a350ad82f66347a9b7b20d47b22d22bd0111` (30 August 2026).
Do not treat the work base as the pre-event cut. Commits from 5–7 September
must be attributed separately as earlier work during this event.

| Work | Attribution |
|---|---|
| View-only reconciler, HTTP API, five statuses, payment requests, payer, merchant demo and webhook primitives | Existing at WORK_BASE_SHA |
| Bounded status adapter, one-operation OpenAPI, isolated five-case runner, tests and runbook | New work in this delivery |
| Ledger Key Ring integration | Skipped; not implemented |
| Uniswap preparation | Not implemented |
| Bazantic sandbox gateway and published Recipe | New hosted demo; five-case operator smoke passed |
| Agent evaluation, without Recipe / with Recipe | New evaluation harness and complete session evidence; [protocol and results](docs/ethonline/bazantic/evaluation/README.md) |
| Video and submission | Pending |

The delivery is recorded in this repository. Compare its source and evidence
against WORK_BASE_SHA to identify the new contribution; the commit history
records the actual publication sequence.

The local example uses synthetic settlements. It demonstrates no new mainnet
payment and does not replace historical payment evidence. The core reconciler,
payment domain, payer and webhook algorithms were not changed for this example.

See [execution status](docs/ethonline/STATUS.md),
[adapter runbook](docs/ethonline/bazantic/README.md) and [AI usage](AI_USAGE.md).
