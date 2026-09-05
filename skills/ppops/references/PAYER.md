# Payer integration workflow

PPOps does not make an ordinary EVM transfer private. A payer must use a
RAILGUN-capable spending wallet/integration that supports private ERC-20
transfers with encrypted memoText.

## Interoperability requirements

1. Fetch the metadata-minimal request.json.
2. Obtain the expected merchant signer through an independent authenticated
   channel.
3. Verify the EIP-712 descriptor and exact chain, native-USDC token, amount,
   recipient, reference/memo, nonce, and expiry.
4. Require private native USDC to be in the payer's Spendable bucket. A fresh
   shield in ShieldPending cannot fund the payment.
5. Generate the exact private transfer with the supplied memo.
6. Submit through an explicitly chosen mode and bounded fee.
7. Preserve local submission/recovery state until canonical settlement is
   known.
8. Complete output PPOI when the wallet flow requires it.

## Reference payer

tools/ppops-payer is a CLI harness built on the official Wallet SDK. It is not a
consumer wallet or merchant runtime. It supports:

- descriptor-only request-verify;
- sync and secret-boundary checks;
- no-send self-signed/Broadcaster preparation;
- diagnostic self-signed Gate A;
- Waku Broadcaster Gate B;
- durable recovery and PPOI finalization.

Use the exact commands from tools/ppops-payer/README.md and its Gate A/Gate B
runbooks. Never infer flags from older chat logs. Never submit without explicit
financial authorization.

Railway Wallet is optional compatibility software and is not PPOps
infrastructure. An ordinary MetaMask-style public EVM transfer cannot satisfy a
PPOps private payment request.
