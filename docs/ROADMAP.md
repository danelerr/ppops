# Product roadmap

This is a sequencing proposal, not a release promise or a list of implemented APIs.

## Now: PayIn

Keep the Octant scope on incoming payments: signed request, usable checkout,
separate payer execution, view-only reconciliation and deterministic merchant events.
The v0.1.0-beta.3 release adds [PayIn UX](PAYIN.md) to the beta.2 baseline.
Validate it with external adopters before broadening scope.

## Next: harden PayIn (candidate v0.2)

- Independently reproduce merchant onboarding and payer completion.
- Validate a compatible wallet handoff and improve reference-payer review/confirmation.
- Show actual network fee previews; estimate private-balance readiness only when
  reliable underlying data exists.
- Improve payer recovery and operational documentation from observed failures.

Balance preparation, swaps/funding, native wallet integrations and notifications
need separate designs and user validation. They are not prerequisites added to
the current merchant daemon.

## Later: Payout, starting with refunds (candidate v0.3)

Only after PayIn adoption and hardening, consider outgoing payment intents:

~~~text
PPOps intent → external policy / approval → external spending wallet
             → private transfer → settlement monitoring → merchant event
~~~

PPOps coordinates and observes. A separately controlled wallet/signing service
authorizes spending; the merchant daemon must not acquire spending keys or custody.
Approval policies, recipient validation, idempotency, transaction recovery, fees,
limits and optional multisig require a dedicated design and review first.

Refunds are the initial candidate because they relate directly to an accepted
PayIn. Payroll, treasury and B2B disbursements are possible later uses, not current
capabilities. POST /v1/payouts, payout states and payout webhooks **do not exist**.
