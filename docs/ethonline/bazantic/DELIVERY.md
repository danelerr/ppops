# Bazantic operational delivery

**Agents can query five PPOps demo payment states through a published Bazantic
gateway and Recipe.** The hosted operator test returned all five states correctly
and preserved the distinction between payment observation and merchant decisions.
The demo uses synthetic settlements in sandbox; no real funds were spent.

Initial hosted verification: 13 September 2026, 05:38 Bolivia. Local cleanup:
10:27 Bolivia. See the [demo script](../HANDOFF.md) and [current status](../STATUS.md).

## Live resources

| Resource | Observed state |
|---|---|
| [Gateway dashboard](https://bazantic.com/gateways/gvp5zq3zpbfqhl5cpjhfkyk5km) | PPOps Demo Status; active; sandbox; owner Daniel's personal account |
| [Gateway MCP](https://gvp5zq3zpbfqhl5cpjhfkyk5km.bazgateway.com/mcp) | HTTP POST tools/list returned 200; tools getDemoPaymentStatus and info |
| [Recipe dashboard](https://bazantic.com/dashboard/recipes/ppops-payment-status-brief) | Published at 09:35:58 UTC; model anthropic/claude-haiku-4.5 |
| [Public OpenAPI](https://classified-corporation-desktop-casio.trycloudflare.com/openapi.json) | HTTPS 200; one read operation; no credential or private intent ID |

The gateway is published by its owner for marketplace consideration; the UI
says **Pending verification**. It is not yet a Bazantic-verified catalog listing.
The original CLI-created gateway `gnn2auglrzgpnp3z6imrguax6a` remains an unused
sandbox draft. Its UI offered no activation control. The final active gateway
was created through the documented Analyze → Review → Activate wizard.

## Verified behavior

- [Public adapter smoke](public-smoke.json): public spec 200, status without
  credential 401, authenticated demo-paid 200 with only alias/status, and
  authenticated administrative route 404.
- [Gateway probe](gateway-probe.json): live MCP inventory and a 402 x402
  challenge for exactly 0.01 test USDC on `base-sepolia`. No settlement signed.
- [Recipe smoke](recipe-smoke.json): one hosted operator test with five actual
  gateway calls, each HTTP 200. OPEN, PARTIAL, PAID, EXPIRED and PAID_LATE matched
  the seeded projections. The output withheld delivery/payment authority.
  Duration 11,126 ms; reported tokens 12,616. This is not an A/B run.
- [Recipe definition](recipe.json) and [published metadata](recipe-published.json)
  preserve the actual prompt, input schema, output example, model and live tool
  binding. Account/creator identifiers are omitted from both metadata snapshots.
  The [draft snapshot](recipe-draft.json) precedes the output-example
  update and publication; the prompt/model/tool were unchanged for publication.

The operator test UI explicitly states that no payment occurs. It invokes real
gateways using Bazantic's operator credential. This proves that execution path,
not a paid public Recipe call, x402 settlement, or MPP settlement. Every payment
event behind PPOps is synthetic. No chain scan, wallet or real invoice is used.

The dashboard's MCP availability indicator disagreed with the successful direct
inventory and hosted calls. Its warning is recorded in the root FEEDBACK.md;
the HTTP evidence above establishes the tested behavior.

## Runtime and restart

The HTTPS origin uses Cloudflare Quick Tunnel and depends on this computer
remaining online. It is temporary and has no uptime guarantee. See the
[official Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
Keep both the tunnel and isolated runner alive during the demo.

Current processes after recovery: cloudflared PID 23198, runner PID 23233. Verify
their identities with `ps -p 23198,23233 -o pid,command` before stopping them;
PIDs may later be reused. For these exact processes, `kill -TERM 23233 23198`
closes the runner and tunnel. Clean runner shutdown removes its synthetic data.
The gateway credential file remains in the ignored `instance/bazantic` directory.

Installed only under that ignored directory: official cloudflared 2026.9.1
(release archive SHA-256
`c27ab8fd0aa489449e3d201eb02f957ef460a13b613662928b1b23394bf1bcfe`, checked
against the release digest), and official npm package @bazantic/cli 0.10.1.
The CLI session has gateway:read/write and recipe:read/write, with no spend grant.
No project dependency or lockfile changed.

To restart, use the [runner instructions](README.md). Start a new tunnel with
`instance/bazantic/cloudflared tunnel --url http://127.0.0.1:8791 --no-autoupdate`.
Pass its newly printed HTTPS origin to the runner's `--public-origin` option;
update the gateway base/spec URLs and verify connection, resource diff, sandbox
challenge and MCP again. A new tunnel URL does not automatically update Bazantic.
Keep credentials in the owner-only file; never paste them into public artifacts.

## Submission preparation and technical notes

1. The [four agent evaluation sessions](evaluation/README.md) are complete: no repeatable improvement.
   All failed the time/token envelope; the first pair had an infrastructure
   failure and the second tied at 5/5. Hosted execution and some model settings
   remain uncontrolled; the improvement requirement is NOT_READY.
2. Video showing the implemented flow and the simulated-payment disclosure.
   The [recording script and submission draft](../HANDOFF.md) are prepared;
   no video has been recorded.
3. Human review of attribution, AI-use transcript and candidate pre-event SHA;
   reviewed delivery commit and final submission. No commit, push, merge or
   submission was performed.
4. Existing dependency audit remains failing with 53 advisories, including
   10 high. Local typecheck/build, 124 tests with coverage, privacy, trust,
   docs and package checks passed in the preceding implementation delivery.

Sources: [gateway workflow](https://bazantic.com/docs/deploy-a-gateway),
[CLI contract](https://bazantic.com/docs/cli), and
[Recipe workflow](https://bazantic.com/docs/recipes), verified against the actual
dashboard, installed CLI help, and results linked above.

## Recovery before the A/B campaign

At 09:39 Bolivia the old trycloudflare hostname no longer resolved. The local
runner still answered HTTP 200; the existing tunnel process repeatedly reported
“Unauthorized: Tunnel not found”. It was not restarted merely because a poll
had timed out. A new tunnel was created, the synthetic runner restarted with
its new public origin, and the active Bazantic gateway's base/spec URLs updated.
The limited demo credential, gateway slug, resource, sandbox setting and Recipe
revision were preserved. New authenticated HTTPS demo-paid returned PAID/200; see the retained
[recovery checks](tunnel-recovery.json).
The original smoke artifacts retain the historical URL and original timestamps.

Current origin: https://classified-corporation-desktop-casio.trycloudflare.com .
An idle-sleep inhibition process is attached to the current demo runner with
`caffeinate -i -w 23233`; it ends when that process exits. This does not provide
hosting durability or a Cloudflare uptime guarantee.
