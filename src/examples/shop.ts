export const SHOP_JS = `"use strict";
const button = document.querySelector('#create');
const message = document.querySelector('#message');
const link = document.querySelector('#checkout');
const output = document.querySelector('#order');
const newOrder = document.querySelector('#new-order');
let id, timer;
try { id = sessionStorage.getItem('ppops-example-order') || undefined; } catch {}

button.onclick = async () => {
  id ??= crypto.randomUUID();
  try { sessionStorage.setItem('ppops-example-order', id); } catch {}
  button.disabled = true;
  newOrder.disabled = true;
  try {
    const response = await fetch('/shop/orders/' + id, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) throw Error();
    link.href = data.checkoutUrl;
    link.hidden = false;
    button.textContent = 'Retry this order';
    newOrder.hidden = false;
    message.textContent = 'Order created. Open the payment request to continue.';
    await poll();
  } catch {
    message.textContent = 'Could not create the order. Retry uses the same order ID.';
  } finally { button.disabled = false; newOrder.disabled = false; }
};

newOrder.onclick = () => {
  clearTimeout(timer);
  id = undefined;
  try { sessionStorage.removeItem('ppops-example-order'); } catch {}
  output.textContent = '';
  link.hidden = true;
  newOrder.hidden = true;
  button.textContent = 'Create order';
  message.textContent = 'Ready to create a separate order. Previous orders remain in the merchant database.';
};

async function poll() {
  clearTimeout(timer);
  const requestedId = id;
  try {
    const response = await fetch('/shop/orders/' + requestedId, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (id !== requestedId) return;
    if (response.status === 404) {
      id = undefined;
      try { sessionStorage.removeItem('ppops-example-order'); } catch {}
      message.textContent = 'Create an order to begin.';
      button.textContent = 'Create order';
      output.textContent = '';
      link.hidden = true;
      newOrder.hidden = true;
      return;
    }
    if (!response.ok) throw Error();
    const data = await response.json();
    if (id !== requestedId) return;
    output.textContent = JSON.stringify(data, null, 2);
    if (data.checkoutUrl) { link.href = data.checkoutUrl; link.hidden = false; }
    button.textContent = 'Retry this order';
    newOrder.hidden = false;
    if (data.status === 'fulfilled') message.textContent = 'Payment verified. Order fulfilled exactly once.';
    else if (data.status === 'needs_review') message.textContent = 'Payment received; merchant review required.';
    else if (data.status === 'expired') message.textContent = 'The payment request expired. Create a new order or contact the merchant.';
    else {
      message.textContent = 'Waiting for payment. Open the payment request to continue.';
      if (!document.hidden) timer = setTimeout(poll, 2000);
    }
  } catch {
    if (id !== requestedId) return;
    message.textContent = 'Connection interrupted. Retrying this order will preserve its identity.';
    if (!document.hidden) timer = setTimeout(poll, 2000);
  }
}

if (id) void poll();
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && id) void poll(); });
`;
