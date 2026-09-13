# Give agents read-only access to PPOps demo payment status

**Published gateway and Recipe; five payment states verified through the hosted integration.**
See [deployment and evidence](DELIVERY.md) for the current URLs and limitations.
This opt-in example serves synthetic payment states through one authenticated
read operation. It runs on loopback and never opens the merchant administration
API or demo payment controls to callers. No sponsor account is needed locally.

## Run the isolated example

From the repository root, with its npm dependencies installed:

```bash
npm run build
node --input-type=module <<'JS'
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('instance/bazantic', { recursive: true, mode: 0o700 });
await writeFile('instance/bazantic/gateway-token', randomBytes(32).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
JS
node examples/bazantic-status.mjs --token-file instance/bazantic/gateway-token
```

The token-generation command refuses to overwrite an existing credential. The
file is ignored by Git. The runner uses port 8791 by default; pass `--port` for
another port. Stop with Ctrl-C. Its temporary databases are removed on clean
shutdown; an abrupt process kill can leave synthetic data in the OS temp folder.
No production configuration, wallet, provider endpoint or spending secret is read.

Use the private token without printing it or putting it into a command argument:

```bash
node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
const token = (await readFile('instance/bazantic/gateway-token', 'utf8')).trim();
const response = await fetch('http://127.0.0.1:8791/v1/demo/payment-status/demo-late', {
  headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
});
console.log(response.status, await response.json());
JS
```

Expected: `200 { requestRef: 'demo-late', status: 'PAID_LATE' }`.

| Alias | Seeded state | Interpretation |
|---|---|---|
| demo-open | OPEN | Observed open; no remaining-time guarantee |
| demo-partial | PARTIAL | Partial payment with expiry already passed; do not request more funds |
| demo-paid | PAID | Reconciler reports paid; the adapter cannot fulfill an order |
| demo-expired | EXPIRED | Expired; subsequent late payment remains possible |
| demo-late | PAID_LATE | Paid late; a merchant policy is required |

States are created through the existing intent service and reconciler with
synthetic settlements, not direct database status writes. The fixtures are
fixed at startup for comparison; the example does not run chain scanning or a
background clock. Every query reads the current stored projection again.
Restarting recreates equivalent cases with new private internal IDs.

## Contract and boundaries

`GET /v1/demo/payment-status/{requestRef}` returns exactly `requestRef` and
`status`. Five native statuses are preserved; an unfamiliar status string maps
to `UNKNOWN`. Missing or invalid fields, mismatched IDs and upstream failures
return a sanitized error. Neither amounts nor timestamps are included.

The adapter copies a bounded alias allowlist at startup. It uses an independent
gateway bearer credential, with the administrative credential remaining inside
the process. Only a fixed status path is requested upstream. The example's
upstream app has no listening socket. `/demo/*`, creation, listings, outbox and
other administrative routes are unavailable on the adapter.

The runner is deliberately restricted to an isolated simulation. The reusable
adapter factory also supports a fixed demo HTTP(S) origin; it is not a
production gateway. Compromise of its host can expose the broad upstream
credential. Independent demo data and isolation remain required.

Limits: 5 s upstream timeout, 16 KiB response body, rejected redirects, no-store
responses and 30 requests/minute shared across the instance. A caller can exhaust
that shared demo quota; it is not a production fairness mechanism. Requests to
the public spec count toward the same quota. No CORS permission is added.

The public `/openapi.json` documents only the status operation. It includes no
credential or internal ID. A standalone copy with the intended origin can be
generated without starting the example or loading any token:

```bash
node examples/bazantic-status.mjs --spec --public-origin https://ppops-demo.example
```

The `.example` origin is a placeholder, not a deployed endpoint. Pass the real
approved HTTPS origin to `--public-origin` when running behind an approved TLS
proxy/tunnel. The same option controls the spec's server URL; it does not open
network access or create a tunnel.

## Verification

```bash
npm test -- test/bazantic-status.test.ts test/api-webhook.test.ts test/core.test.ts
npm run typecheck
npm run build
node scripts/bazantic-status-smoke.mjs
```

The smoke starts the compiled runner on an ephemeral loopback port, verifies all
five states over real local HTTP, rejects unauthorized and administrative calls,
checks the spec and clean shutdown, then deletes its temporary token. It sends
no requests to Bazantic and makes no blockchain payment.

Verification on 13 September 2026: 29 adapter tests passed; the complete merchant
suite passed 124 tests with its existing coverage thresholds. Typecheck, build,
docs, privacy, trust-boundary and packaged smoke checks passed. The full `verify`
command exited 1 at dependency audit: 53 existing-tree advisories, including
10 high. This delivery changes neither dependencies nor lockfiles. A clean
dependency install and the separate payer verification were not run.

## Publication and Recipe

Daniel authorized HTTPS demo publication and sharing the limited gateway
credential with Bazantic. The gateway is active in sandbox and the Recipe is
published. [Delivery evidence](DELIVERY.md) includes real URLs, the exact
[Recipe definition](recipe.json), the [hosted smoke](recipe-smoke.json), and the
[publication metadata](recipe-published.json). No funds were spent.

The gateway exposes `getDemoPaymentStatus` and Bazantic's generated `info`
metadata helper. Only the status tool is bound to the Recipe. Its model is
`anthropic/claude-haiku-4.5`. The tool description retains all status semantics.
The hosted operator smoke used five real gateway calls; it does not demonstrate
paid x402/MPP settlement or A/B improvement.

[Gateway documentation](https://bazantic.com/docs/deploy-a-gateway) describes
the deployment workflow. [Recipes documentation](https://bazantic.com/docs/recipes)
describes testing and publication. Both were recovered by direct HTTP on
13 September 2026 after the web lookup tool failed.

## Agent evaluation

The [evaluation report](evaluation/README.md) brings together the protocol,
results and complete traces for two comparisons: **without Recipe** and
**with Recipe**. Both use the same task, model and API information. The report
distinguishes this guidance comparison from the hosted integration test above
and documents the limits of the experiment and sponsor evidence.
