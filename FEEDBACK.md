# ETHOnline tooling feedback — in progress

## Bazantic

Observed on 13 September 2026 using the web dashboard and current documentation.
CLI @bazantic/cli 0.10.1 was installed in the ignored demo instance directory.

- Direct HTTP retrieved the gateway, Recipe and CLI documentation successfully,
  while the web lookup tool reported retrieval errors. This was not evidence of
  a Bazantic outage. A simple downloadable documentation format would reduce
  friction for clients that cannot use that lookup path.
- The signed-in account exposes a three-stage gateway wizard and a Recipe
  editor. The gateway wizard supports pasting a spec, which is useful before a
  public spec URL exists.
- Recipe draft tests and published Recipe calls have different payment and
  execution paths. A documented side-by-side benchmark workflow that pins the
  model, settings and identical raw tool access would help satisfy the bounty's
  comparison requirement without introducing hidden differences.

Deployment, Recipe smoke and four Codex agent-evaluation session records now exist. The comparison demonstrated no repeatable improvement.

- The CLI accepted a draft gateway, but its detail/actions UI exposed no activation
  control and marketplace publication failed with “Activate this gateway before
  you publish it.” The documented wizard is being used to reach activation.
- The CLI api-key default selected URL-path credential delivery; the dashboard
  allowed correcting it to Authorization bearer. Explicit delivery flags would
  avoid this mismatch with bearer-secured OpenAPI specifications.

- The Recipe create API accepted JSON Schema `uniqueItems`, while the dashboard
  blocked publication with “Keyword uniqueItems is not supported.” Removing that
  unsupported keyword retained a bounded five-item input and unblocked the UI.
- The dashboard reported “MCP Server UNAVAILABLE Gateway unreachable” while a
  direct MCP `tools/list` returned HTTP 200 and the operator Recipe successfully
  executed all five status calls. Separating browser reachability from server
  liveness would make this status easier to interpret.
- The hosted Recipe smoke completed five status lookups in 11,126 ms, with
  12,616 reported tokens, using anthropic/claude-haiku-4.5. All five states were
  correct and no delivery/payment action was recommended. This is an integration
  observation, not a comparison or a claim of improvement.

- Evaluation setup inspection: Recipe Advanced exposes a model selector, schema toggle
  and output example, but no temperature or token ceiling. Playground is an
  HTTP request tester. These interfaces do not by themselves establish a raw
  API/Recipe comparison with all model settings matched. A documented matched
  agent evaluation workflow would resolve this gap. Four subsequent Codex sessions used exported Recipe guidance and identical direct adapter access; this did not test the hosted Recipe runtime.

- Evaluation tooling: Codex reported usage only at completion; all three completed
  runs exceeded our predefined total-token ceiling. A hard total-context budget
  or streaming usage would help enforce this protocol. One run had a bridge
  UPSTREAM_UNAVAILABLE response and timed out; its underlying exception was not
  retained. These are evaluation limitations, not established Bazantic faults.
- Codex emitted permission warnings for temporary cleanup/system-skill loading
  in all four sessions, but still executed commands. Complete stderr is retained
  in docs/ethonline/bazantic/evaluation/. No global permissions were changed.
