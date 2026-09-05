# Payment states and merchant policy

PPOps maintains two kinds of state: the intent your application created and the
individual private settlements that may contribute to it.

A settlement is credited only when chainStatus is FINALIZED, poiStatus is
SPENDABLE and matchStatus is MATCHED. Its reference, chain and token must
resolve to the local intent. A detected transaction can remain pending.

## Intent state

| Status | Exact meaning | Typical merchant action |
| --- | --- | --- |
| OPEN | No credited amount, before expiry; pending notes may already exist | Wait |
| PARTIAL | Credited amount is positive but below the expected amount, even after expiry | Check expiresAt and apply partial-payment policy |
| EXPIRED | No credited amount and current time is at or after expiry | Stop requesting payment; review any later receipts |
| PAID | Credited amount reaches the target; the settlement crossing the target has blockTimestamp at or before expiresAt | Fulfill after authenticated verification |
| PAID_LATE | Target is reached by a settlement whose blockTimestamp is after expiresAt | Apply late-payment policy, usually review |

PAID versus PAID_LATE uses the transfer's block timestamp, not the time at which
a delayed scan or PPOI check completed. A payment arriving exactly at expiresAt
is on time. A partial payment does not transition to EXPIRED merely because the
clock passes expiry.

receivedAmountAtomic is credited value. pendingAmountAtomic is matched value
not yet eligible. overpaymentAmountAtomic is credited value above the target.
All are integer strings in token atomic units.

The checkout presents partial-and-expired explicitly even though the API keeps
the backwards-compatible PARTIAL state.

## Events

| Type | Trigger |
| --- | --- |
| settlement.observed | A new matched settlement is first stored; not proof of payment |
| payment.partial | The credited partial amount changes |
| payment.confirmed | An intent transitions from unpaid to PAID or PAID_LATE |
| payment.expired | An intent transitions to EXPIRED |
| payment.reverted | A previously paid intent becomes unpaid after reconciliation |

Confirmation is not an irrevocable business event: rechecking can detect a
reverted settlement. Route payment.reverted to review/compensation appropriate
to the product you sell.

Delivery is **at least once**. Exactly-once fulfillment is the merchant's database
guarantee, using a unique event ID and an idempotent order transition. Accept
valid duplicate deliveries with 2xx. Persist and acknowledge valid events you do
not use for fulfillment as well; rejecting them creates needless retries.

Before launch decide what happens to partial, late, excess and reverted amounts.
PPOps cannot refund funds because the merchant daemon cannot spend.
