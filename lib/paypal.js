'use strict';

/** Minimal PayPal Orders v2 client — no SDK, plain fetch. */

function envName() {
  const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
  return mode === 'live' ? 'live' : 'sandbox';
}

function baseUrl() {
  return envName() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function configured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');
  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`PayPal auth failed (${res.status}): ${data.error_description || data.error || 'unknown error'}`);
  }
  return data.access_token;
}

async function createOrder({ amount, currency, description, returnUrl, cancelUrl, referenceId }) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': referenceId,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: referenceId,
          description: description.slice(0, 127),
          amount: { currency_code: currency, value: amount.toFixed(2) },
        },
      ],
      application_context: {
        brand_name: process.env.STORE_NAME || 'SAFRONBEATS',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`PayPal order failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  const approve = (data.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!approve) throw new Error('PayPal did not return an approval link.');
  return { id: data.id, approveUrl: approve.href, raw: data };
}

async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`PayPal capture failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: data.status,
    captureId: capture?.id || null,
    amount: capture?.amount?.value || null,
    currency: capture?.amount?.currency_code || null,
    payerEmail: data.payer?.email_address || null,
    payerName: [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(' '),
    raw: data,
  };
}

module.exports = { configured, envName, createOrder, captureOrder };
