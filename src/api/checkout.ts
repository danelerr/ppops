export const CHECKOUT_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment request · PPOps</title><link rel="stylesheet" href="/assets/pay.css"></head>
<body><main>
  <header><p class="eyebrow">PPOps / Private USDC payments</p><p id="demo-banner" class="notice" hidden>SIMULATION ONLY · No funds move. This recipient cannot receive real payments.</p><h1>Your payment request</h1></header>
  <p id="state" role="status" aria-live="polite">Loading payment details…</p>
  <p id="connection" class="notice" role="status" hidden></p><button id="retry" hidden>Try again</button>
  <section id="payment" hidden>
    <p class="amount" id="amount"></p><p class="network" id="network"></p>
    <ol class="progress" aria-label="Payment progress"><li id="step-waiting">Awaiting payment</li><li id="step-verifying">Verifying receipt</li><li id="step-paid">Payment confirmed</li></ol>
    <dl class="summary"><dt>Status</dt><dd id="status"></dd><dt>Expires</dt><dd id="expiry"></dd><dt>Received</dt><dd id="received"></dd><dt>Being verified</dt><dd id="pending"></dd></dl>
    <div id="instructions"><h2>Pay from your RAILGUN wallet</h2><p>You need private native USDC already available to spend on Arbitrum, plus the wallet’s transfer fee. A public token transfer will not pay this request.</p>
    <p>Use an integration that verifies the merchant identity and preserves the exact payment memo. Check compatibility before sending.</p>
    <a href="/payer-guide" id="payer-guide">How to use a compatible payer</a>
    <h2>Recipient</h2><pre id="recipient"></pre><button type="button" data-copy="recipient">Copy recipient</button>
    <h2>Payment memo</h2><p>Include this exact memo in the private transfer. Your wallet encrypts it.</p><pre id="memo"></pre><button type="button" data-copy="memo">Copy memo</button>
    <p><a id="request-download">Download payment request</a></p></div>
    <button id="simulate" hidden>Simulate payment</button><p id="demo-next" hidden><a href="/shop/">Return to the example shop</a> to inspect fulfillment.</p>
    <details><summary>Technical details and merchant identity</summary><p>The wallet must verify this signature against a merchant signer obtained through a separate trusted channel. Loading this page alone does not verify merchant identity.</p><dl><dt>Chain ID</dt><dd id="chain"></dd><dt>Token</dt><dd id="token"></dd></dl><pre id="signer"></pre><pre id="descriptor"></pre></details>
    <footer>PPOps observes incoming payments. Your wallet keeps spending authority. Never enter a recovery phrase on this page.</footer>
  </section>
</main><script src="/assets/pay.js" defer></script></body></html>`;

export const CHECKOUT_CSS = `
:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#15304b;background:#eff5fa;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;padding:24px 16px}main{max-width:720px;margin:24px auto;padding:clamp(24px,6vw,48px);background:white;border:1px solid #d6e2ed;border-radius:16px;box-shadow:0 16px 48px #15304b0a}h1{font-size:clamp(1.8rem,6vw,2.7rem);letter-spacing:-.045em;line-height:1.12;margin:16px 0 24px}h2{font-size:1.06rem;margin:28px 0 10px}p{line-height:1.65}.eyebrow{font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:#466580;font-weight:700}.amount{font-family:Georgia,"Times New Roman",serif;font-size:clamp(2.8rem,10vw,4.5rem);line-height:1;margin:32px 0 12px;font-variant-numeric:tabular-nums}.amount span{font-family:system-ui,sans-serif;font-size:1rem;color:#466580}.network{margin-top:0;color:#466580}.progress{padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;list-style:none;margin:32px 0;font-size:.8rem;color:#466580}.progress li{border-top:4px solid #d6e2ed;padding-top:10px}.progress li.active{border-color:#245fc6;color:#15304b;font-weight:700}.progress li.done{border-color:#147369;color:#147369}dl{display:grid;grid-template-columns:minmax(90px,1fr) minmax(0,3fr);gap:12px;margin:0}dt{color:#466580}dd{margin:0;overflow-wrap:anywhere}.summary{border-top:1px solid #d6e2ed;border-bottom:1px solid #d6e2ed;padding:20px 0;font-size:.9rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font: .8rem/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;background:#eff5fa;padding:16px;border-radius:8px}button{font:inherit;font-weight:650;border:1px solid #245fc6;background:#245fc6;color:white;border-radius:7px;padding:12px 18px;cursor:pointer;min-height:44px}button:hover{background:#184ba1}button:disabled{opacity:.6;cursor:wait}a{color:#245fc6;text-underline-offset:3px;overflow-wrap:anywhere}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #8a5b0a;outline-offset:4px}details{margin-top:30px;padding:20px 0;border-top:1px solid #d6e2ed}summary{cursor:pointer;font-weight:650;line-height:1.5}footer{font-size:.8rem;line-height:1.6;color:#466580;padding-top:24px}.notice{padding:12px 16px;background:#fff4db;border-left:3px solid #8a5b0a;color:#61410b;border-radius:4px}.success{color:#147369;font-weight:650}[hidden]{display:none!important}@media(max-width:420px){body{padding:12px 8px}main{margin:0 auto;padding:22px 18px}.progress{font-size:.72rem}dl{grid-template-columns:1fr 2fr}}
`;

export const CHECKOUT_JS = `"use strict";
const byId=(id)=>document.getElementById(id),intentId=location.pathname.split('/').filter(Boolean).at(-1);
let timer,lastData,loading=false;
const requestPath='/pay/'+encodeURIComponent(intentId)+'/request.json';
const formatted=(value,decimals)=>{const text=String(value).padStart(decimals+1,'0');return decimals?text.slice(0,-decimals)+'.'+text.slice(-decimals).replace(/0+$/,'').padEnd(Math.min(decimals,2),'0'):text;};
function render(data){
  lastData=data;const paid=['PAID','PAID_LATE'].includes(data.status),expired=Date.now()/1000>=data.expiresAt;
  const pending=BigInt(data.pendingAmountAtomic)>0n,partial=BigInt(data.receivedAmountAtomic)>0n&&!paid;
  const labels={OPEN:'Awaiting payment',PARTIAL:'Partially paid',PAID:'Payment confirmed',EXPIRED:'Request expired',PAID_LATE:'Confirmed after expiry'};
  byId('amount').textContent=formatted(data.amountAtomic,data.decimals)+' '+data.tokenSymbol;
  byId('network').textContent=(data.simulated?'Local simulation · ':data.chainId===42161?'Arbitrum · ':'Chain '+data.chainId+' · ')+data.tokenSymbol;
  byId('status').textContent=(partial&&expired?'Partially paid · request expired':expired&&!paid?'Request expired':labels[data.status])||'Checking payment';
  byId('expiry').textContent=new Date(data.expiresAt*1000).toLocaleString()+(expired?' (expired)':'');
  byId('received').textContent=formatted(data.receivedAmountAtomic,data.decimals)+' '+data.tokenSymbol;
  byId('pending').textContent=formatted(data.pendingAmountAtomic,data.decimals)+' '+data.tokenSymbol;
  byId('state').textContent=paid?(data.status==='PAID_LATE'?'Payment confirmed after expiry. Contact the merchant to confirm delivery.':'Payment confirmed. You can return to the merchant.'):
    pending?'Payment detected. Waiting for finality and spending eligibility.':expired?'This request has expired. Ask the merchant for the next step before sending.':
    partial?'A partial payment has been received. Ask the merchant how to complete this order.':'Review the amount and use a compatible private-payment wallet.';
  byId('state').className=paid?'success':'';
  if(data.simulated&&!paid&&!expired)byId('state').textContent='Try a simulated payment to see confirmation and order fulfillment. No wallet is needed.';
  byId('chain').textContent=String(data.chainId);byId('token').textContent=data.tokenAddress;
  byId('recipient').textContent=data.recipient;byId('memo').textContent=data.memo;
  byId('signer').textContent=data.expectedMerchantSigner;byId('descriptor').textContent=JSON.stringify(data.descriptor,null,2);
  byId('request-download').href=requestPath;byId('request-download').setAttribute('download','ppops-request.json');
  byId('demo-banner').hidden=!data.simulated;byId('simulate').hidden=!data.simulated||paid||expired;
  byId('demo-next').hidden=!data.simulated;byId('instructions').hidden=paid||expired||partial||pending||data.simulated===true;
  byId('step-waiting').className=paid||pending?'done':'active';byId('step-verifying').className=paid?'done':pending?'active':'';byId('step-paid').className=paid?'done':'';
  byId('payment').hidden=false;byId('connection').hidden=data.reconciliationReady!==false;
  if(data.reconciliationReady===false)byId('connection').textContent='The merchant is synchronizing payment history. Wait before sending; confirmation updates may be delayed.';
  if(data.reconciliationReady===false)byId('instructions').hidden=true;
}
function unavailable(message){if(lastData)render(lastData);byId('instructions').hidden=true;byId('simulate').hidden=true;byId('connection').hidden=false;byId('connection').textContent=message;byId('retry').hidden=false;}
async function load(){if(loading)return;loading=true;clearTimeout(timer);byId('retry').hidden=true;
try{const response=await fetch(requestPath,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});if(!response.ok){unavailable(response.status===404?'Payment request not found. Check the link with the merchant.':'Payment details are unavailable. Check your connection and try again.');return;}render(await response.json());}
catch{unavailable('Connection interrupted. The displayed payment status may be out of date.');}
finally{loading=false;if(!document.hidden)timer=setTimeout(load,5000);}}
byId('retry').onclick=load;document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)void load();});
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(byId(button.dataset.copy).textContent);button.textContent='Copied';}catch{byId('connection').hidden=false;byId('connection').textContent='Copy was unavailable. Select and copy the field manually.';}}));
byId('simulate').onclick=async()=>{byId('simulate').disabled=true;try{const r=await fetch('/demo/'+encodeURIComponent(intentId)+'/confirm',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!r.ok)throw Error();await load();}catch{byId('connection').hidden=false;byId('connection').textContent='Simulation could not complete. Try again.';}finally{byId('simulate').disabled=false;}};
void load();`;

export const PAYER_GUIDE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>How to pay · PPOps</title><link rel="stylesheet" href="/assets/pay.css"><main><p class="eyebrow">PPOps / Payer guide</p><h1>Use a compatible private-payment wallet</h1><p>This beta supports native USDC on Arbitrum through a RAILGUN private transfer. Public EVM transfers cannot pay this request.</p><ol><li>Use a wallet with private USDC already available to spend, plus enough for its quoted fee.</li><li>Obtain the merchant’s public signer address through a separate trusted channel.</li><li>Download the payment request. The payer integration must verify its signature, recipient, token, amount, memo and expiry.</li><li>Prepare the transfer, review the amount and fee, then authorize it in your wallet.</li><li>Return to the request page and wait for confirmation. If submission is ambiguous, recover the existing payment before sending again.</li></ol><h2>Compatibility in this release</h2><p>The repository’s <code>tools/ppops-payer</code> is the reference integration, intended for technical users. It has controlled Arbitrum pilot evidence. It runs on a payer-controlled host, separate from the merchant.</p><p>General consumer-wallet support and wallet deep links have not been independently validated. A wallet must preserve the encrypted memo and verify the descriptor; a “connect wallet” button alone is insufficient.</p><p>For the executable reference workflow, read <code>docs/PAYER-INTEGRATION.md</code> from the same source release as the daemon. Your merchant can provide that guide and the request file.</p><p>Never provide wallet recovery phrases or spending keys to the merchant or this page.</p></main></html>`;
