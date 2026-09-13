# PPOps — payment status for agents

**Let agents check payment status with read-only access.**
PPOps connects payment information to agent tools through Bazantic, while
merchants retain control of their funds and business decisions.

## Project description

Merchants need to distinguish an open payment request from one that is partially
paid, paid, expired, or paid late. Those distinctions matter when an agent checks
an order: a late payment requires merchant policy, not just a paid flag.

PPOps already provides private-payment reconciliation and a separate payer.
This delivery adds a query interface for agents: an API that returns an alias
and the observed payment status, a published MCP gateway in Bazantic, and a
Recipe that explains how to interpret each response.

The workflow is straightforward: the agent queries PPOps, preserves the exact
status, and explains what the merchant needs to consider before acting. Its
credential grants access to the authorized demo cases. Spending keys and the
administrative API remain outside that access.

The hosted integration correctly queried all five states through the real
gateway. This delivery includes 29 adapter tests; the complete merchant test
suite passed 124 tests. The demonstration uses simulated payments and a sandbox
gateway.

**Closing line:** “PPOps gives agents read-only access to payment information,
while merchants stay in control of their funds.”

## Three-minute demo outline

| Time | Show | Suggested narration |
|---|---|---|
| 0:00–0:25 | Project and the five payment states | “Merchants need to know what happened to each payment. PPOps distinguishes partial, expired, and late payments. We now make that information accessible to agents.” |
| 0:25–0:50 | PPOps Demo Status gateway in Bazantic and its query tool | “This delivery connects PPOps to Bazantic through a read-only MCP tool. The demo uses simulated payments; the connection between the two services is real.” |
| 0:50–1:35 | Run the Recipe with the five example aliases and show its responses | “The agent queries each payment and receives its observed status. Here are all five cases, from an open payment request to a payment received after expiry.” |
| 1:35–2:05 | Highlight the PAID_LATE result | “This payment arrived late. PPOps preserves that distinction, and the Recipe explains that the merchant needs to apply their policy before deciding whether to fulfill the order.” |
| 2:05–2:30 | API response with alias and status; GET operation in OpenAPI | “The agent gets the information it needs through a query credential. Administrative operations and spending keys remain under the merchant's control.” |
| 2:30–3:00 | Adapter, tests, and integration files | “The PayIn and reconciler are the existing foundation. During this delivery, we added the agent API, gateway, Recipe, and tests. PPOps gives agents read-only access to payment information.” |

Open the [gateway](https://bazantic.com/gateways/gvp5zq3zpbfqhl5cpjhfkyk5km) and
[Recipe](https://bazantic.com/dashboard/recipes/ppops-payment-status-brief)
before recording. The dashboard's operator test performs real queries without
charging a payment. Keep the host computer online to maintain the demo tunnel.

Record your screen with human narration, between 2 and 4 minutes, at 720p or
higher. You may edit out waiting time. Keep the actual responses visible and
credentials off-screen. [Video guidelines](https://ethglobal.com/events/ethonline2026/info/details).

## Technical evidence and attribution

- [Published integration and functional evidence](bazantic/DELIVERY.md).
- [Without Recipe / with Recipe evaluation](bazantic/evaluation/README.md),
  including the full protocol, responses, and metrics. The comparison did not
  establish a repeatable improvement; this presentation describes the
  demonstrated functionality.
- CONTINUITY.md and AI_USAGE.md in the source checkout root document existing
  work, this delivery's contributions, and AI assistance. The pre-event commit
  boundary still requires human review.

To apply specifically for Bazantic's comparative prize, include both outcomes
and explain the comparison in the video, following its
[requirements](https://ethglobal.com/events/ethonline2026/prizes/bazantic).
The functional demo alone does not establish that prize requirement.

## Submission preparation

Submission repository: https://github.com/danelerr/ppops . The delivery is
published in commit `8f85a323d1df0df5c8ff66fb78051d6195ecda14`. The dashboard
confirms Continuity Track. Project text, images, repository, technology choices,
and AI attribution are saved. The final form still requires the demo video.
Attribution distinguishes existing work from work completed during this delivery.
If selecting Bazantic, provide the account's registration username (GitHub handle
or email) in the form so the Recipe can be attributed to you. The project has
not yet been submitted.
