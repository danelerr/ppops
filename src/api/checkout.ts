export { CHECKOUT_JS } from "./checkout.generated.js";
import { CHECKOUT_ASSET_VERSION } from "./checkout.generated.js";

export const CHECKOUT_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>Private payment · PPOps PayIn</title><link rel="stylesheet" href="/assets/pay.css?v=${CHECKOUT_ASSET_VERSION}"></head>
<body><main>
  <header><p class="eyebrow"><svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><path d="M4 4h16v6H10v18H4zM15 15h13v13H15v-5h7v-3h-7z" fill="currentColor"/></svg>PPOps / PayIn</p><p id="demo-banner" class="notice" hidden>SIMULATION ONLY · No funds move. This recipient cannot receive real payments.</p><h1>Private payment</h1></header>
  <noscript><p class="notice">JavaScript is needed to verify this request and refresh its status. Contact the merchant if you cannot enable it. Never send funds from an unverified request.</p></noscript>
  <p id="connection" class="notice" role="status">Loading and verifying payment details…</p><button id="retry" type="button" hidden>Check again</button>
  <section id="payment" hidden aria-label="Payment request">
    <p class="amount" id="amount"></p><p class="network" id="network"></p>
    <div class="verification"><span>Merchant request</span><strong id="verification" role="status">Checking signature…</strong></div>
    <p class="hint">The signature protects this request. Your wallet must also recognize the merchant before you approve a payment.</p>
    <div class="payment-state" aria-live="polite" role="status"><h2 id="status">Loading payment details…</h2><p id="state"></p></div>
    <ol class="progress" aria-label="Payment progress"><li id="step-waiting">Awaiting payment</li><li id="step-verifying">Checking payment</li><li id="step-paid">Complete</li></ol>
    <dl class="summary"><dt id="received-label">Received</dt><dd id="received"></dd><dt id="pending-label">Being checked</dt><dd id="pending"></dd><dt id="remaining-label">Remaining</dt><dd id="remaining"></dd><dt id="overpayment-label" hidden>Overpayment</dt><dd id="overpayment" hidden></dd><dt>Request expires</dt><dd id="expiry"></dd></dl>
    <div id="instructions">
      <button id="pay" type="button" aria-expanded="false" aria-controls="handoff">Pay privately</button>
      <p class="hint">Requires a compatible payer with private USDC ready to use. This beta does not connect to your wallet.</p>
      <section id="handoff" hidden aria-label="Wallet handoff">
        <h2>Use a compatible payer</h2><p>Scan this request or copy its link into a compatible payer. Verify the merchant there, review the amount and network fee, then confirm in your wallet.</p>
        <canvas id="request-qr" role="img" aria-label="QR containing this payment request URL"></canvas><p id="qr-message" class="hint"></p>
        <p id="request-url" class="request-url"></p><button type="button" id="copy-request">Copy payment request</button><p><a id="request-download">Download payment request</a></p>
        <p class="hint">The QR contains a request link, not a receiving address. Anyone with the link can read the request and its status. Do not publish it.</p>
        <a href="/payer-guide" id="payer-guide">Compatible payer &amp; balance preparation guide →</a>
      </section>
    </div>
    <button id="simulate" type="button" hidden>Simulate payment</button><p id="demo-next" hidden><a href="/shop/">Return to the example shop</a> to inspect fulfillment.</p>
    <p id="background-note" class="hint">The merchant keeps checking independently of this page. You may close it and reopen this same link for an updated status. Browser updates pause while this tab is hidden.</p>
    <details><summary>Advanced details</summary>
      <p>Signature validity is not merchant identity. Obtain the merchant's public signer through a separate trusted channel, never from this page alone. No wallet secrets belong here.</p>
      <label for="trusted-signer">Independently obtained public merchant signer</label><input id="trusted-signer" type="text" autocomplete="off" spellcheck="false" placeholder="Public signer address (0x…)"><button type="button" id="verify-signer">Compare signer</button><p id="signer-result" role="status"></p>
      <dl><dt>Chain ID</dt><dd id="chain"></dd><dt>Token</dt><dd id="token"></dd><dt>Request signer</dt><dd id="signer"></dd></dl>
      <h2>Private receiving address</h2><pre id="recipient"></pre>
      <h2>Payment reference</h2><pre id="memo"></pre>
      <h2>Signed descriptor</h2><pre id="descriptor" tabindex="0"></pre>
      <p>A public token transfer does not pay this request. Compatible payers preserve the reference automatically; do not send manually unless your integration supports it.</p>
    </details>
    <footer>Self-hosted · View-only · No trackers<br>PPOps cannot spend or refund funds. Never enter a recovery phrase, spending key, viewing key or API token on this page.</footer>
  </section>
</main><script src="/assets/pay.js?v=${CHECKOUT_ASSET_VERSION}" defer></script></body></html>`;

export const CHECKOUT_CSS = `
:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#201a29;background:#faf9fd;font-synthesis:none;--purple:#713bc4;--ink:#19151f;--line:#ddd7e5;--muted:#665e70}
*{box-sizing:border-box}body{margin:0;padding:24px 16px}main{max-width:580px;margin:24px auto;padding:clamp(24px,6vw,42px);background:white;border:1px solid var(--line);border-top:4px solid var(--purple);border-radius:10px}
h1{font-size:1.65rem;letter-spacing:-.04em;line-height:1.2;margin:24px 0 0}h2{font-size:1.05rem;margin:22px 0 8px}p{line-height:1.6}.eyebrow{display:flex;align-items:center;gap:10px;font:.73rem/1.5 ui-monospace,monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--purple)}.amount{font-size:clamp(2.2rem,9vw,3.6rem);font-weight:550;letter-spacing:-.06em;line-height:1.15;margin:22px 0 8px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.network,.hint{color:var(--muted);font-size:.83rem}.network{margin:0 0 24px}.verification{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:13px 0;border-block:1px solid var(--line);font-size:.82rem}.verification strong{font-weight:600;color:var(--purple)}
.payment-state{margin-top:24px;border-left:3px solid var(--purple);padding:4px 0 4px 14px}.payment-state h2{margin:0;font-size:1.1rem}.payment-state p{margin:8px 0 0;font-size:.92rem}
.progress{padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;list-style:none;margin:24px 0;font-size:.73rem;color:var(--muted)}.progress li{border-top:3px solid var(--line);padding-top:10px}.progress li.active{border-color:var(--purple);color:var(--purple);font-weight:600}.progress li.done{border-color:#246346;color:#246346}
dl{display:grid;grid-template-columns:minmax(90px,1fr) minmax(0,2fr);gap:12px;margin:0}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.summary{border-block:1px solid var(--line);padding:20px 0;font-size:.87rem}.summary dd{text-align:right}pre,.request-url{white-space:pre-wrap;overflow-wrap:anywhere;font:.76rem/1.65 ui-monospace,monospace}pre{background:var(--ink);color:#f1eafa;padding:16px;border-radius:4px}
button{font:inherit;font-size:.9rem;font-weight:600;border:1px solid var(--purple);background:var(--purple);color:white;border-radius:5px;padding:12px 18px;cursor:pointer;min-height:44px}button:hover{background:var(--ink);border-color:var(--ink)}button:disabled{opacity:.6;cursor:not-allowed}#pay,#simulate{width:100%;margin-top:24px}a{color:var(--purple);text-underline-offset:3px;overflow-wrap:anywhere}
button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,pre:focus-visible{outline:3px solid var(--purple);outline-offset:4px}details{margin-top:28px;padding:20px 0;border-top:1px solid var(--line)}summary{cursor:pointer;font-weight:600;line-height:1.5}details p{font-size:.86rem}label{display:block;font-size:.8rem;margin-bottom:8px}input{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:4px;margin-bottom:12px}#verify-signer{margin-bottom:12px}footer{font-size:.75rem;line-height:1.6;color:var(--muted);padding-top:24px;border-top:1px solid var(--line)}
.notice{padding:12px 16px;background:#fff4db;border-left:3px solid #83530b;color:#61410b;font-size:.87rem}.success{color:#246346}#handoff{padding-block:8px}canvas{display:block;max-width:100%;height:auto;margin:18px auto}.request-url{padding:10px;background:#f0eafa}#qr-message:empty{display:none}[hidden]{display:none!important}@media(max-width:420px){body{padding:12px 8px}main{margin:0 auto;padding:22px 18px}.progress{font-size:.68rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

export const PAYER_GUIDE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>How to pay · PPOps</title><link rel="stylesheet" href="/assets/pay.css?v=${CHECKOUT_ASSET_VERSION}"><main>
<p class="eyebrow">PPOps / Payer guide</p><h1>Pay from your own private wallet</h1>
<p>You need private native USDC on Arbitrum, including enough for the network fee. A public token transfer does not pay this request.</p>
<ol><li>Open the payment request in a compatible payer. Obtain the merchant's public signer through a separate trusted channel.</li><li>Check that your private balance is ready. Review the payment amount and current network fee.</li><li>Authorize the payment in your own wallet, not on the merchant page.</li><li>Reopen the checkout to check acceptance. You can close it while the merchant continues checking.</li></ol>
<h2>If your balance is not ready</h2>
<p><strong>Private balance preparing:</strong> funds exist but cannot be used yet. Let your wallet finish its privacy checks and check again. No reliable waiting-time estimate is available.</p>
<p><strong>Insufficient private balance:</strong> compare the available and preparing amounts with the payment plus fee. Prepare additional funds only through your own wallet's documented workflow; PPOps does not fund or shield a wallet.</p>
<p><strong>Wallet updating or unavailable:</strong> let synchronization finish or restore connectivity before sending. If an earlier submission is uncertain, recover that payment before attempting another.</p>
<h2>Which payer can I use?</h2>
<p>The repository's <code>tools/ppops-payer</code> is the reference implementation on a payer-controlled host. Its working-tree <code>readiness</code> command reports available/preparing balances without submitting funds. Read <code>docs/PAYER-INTEGRATION.md</code> from the matching source checkout for the executable workflow.</p>
<p>The QR contains the request URL. General consumer-wallet scanning and one-click wallet connections are not validated. Your merchant can supply the reference guide and request file.</p>
<details><summary>Advanced integration requirements</summary><p>A payer must support RAILGUN V2 private transfers and verify the signed descriptor against an independently trusted signer, including chain, token, amount, recipient, reference and expiry. It must preserve the encrypted memo and recheck live state before submission.</p></details>
<p>Never provide recovery phrases, spending or viewing keys, API tokens or database keys to the merchant or this page.</p></main></html>`;
