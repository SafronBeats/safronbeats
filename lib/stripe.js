'use strict';

/** Minimal Stripe Checkout client — no SDK, plain form-encoded fetch. */

function configured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function stripeRequest(pathname, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.append(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Stripe error (${res.status}): ${data.error?.message || 'unknown error'}`);
  }
  return data;
}

async function createSession({ items, currency, successUrl, cancelUrl, orderId, customerEmail }) {
  const params = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: orderId,
    'metadata[orderId]': orderId,
    customer_email: customerEmail || undefined,
    'payment_intent_data[description]': (process.env.STORE_NAME || 'SAFRONBEATS') + ' beat license',
  };
  items.forEach((item, i) => {
    params[`line_items[${i}][quantity]`] = 1;
    params[`line_items[${i}][price_data][currency]`] = currency.toLowerCase();
    params[`line_items[${i}][price_data][unit_amount]`] = Math.round(item.amount * 100);
    params[`line_items[${i}][price_data][product_data][name]`] = item.name.slice(0, 120);
    if (item.description) {
      params[`line_items[${i}][price_data][product_data][description]`] = item.description.slice(0, 200);
    }
  });
  return stripeRequest('/checkout/sessions', params);
}

async function retrieveSession(sessionId) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe session lookup failed (${res.status})`);
  return data;
}

module.exports = { configured, createSession, retrieveSession };
