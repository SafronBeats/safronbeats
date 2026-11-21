'use strict';

/** Offline shape-check for the PayPal and Stripe clients (no network, no keys). */

const realFetch = global.fetch;
const calls = [];
let mode = 'paypal';

global.fetch = async (url, opts = {}) => {
  calls.push({ url, opts });
  const body = opts.body ? String(opts.body) : '';
  if (url.includes('/v1/oauth2/token')) {
    return json({ access_token: 'TESTTOKEN', expires_in: 3600 });
  }
  if (url.includes('/v2/checkout/orders') && !url.includes('/capture')) {
    return json({
      id: 'PP-ORDER-1',
      status: 'CREATED',
      links: [
        { rel: 'self', href: 'https://api/orders/1' },
        { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PP-ORDER-1' },
      ],
    });
  }
  if (url.includes('/capture')) {
    return json({
      id: 'PP-ORDER-1',
      status: 'COMPLETED',
      payer: { email_address: 'buyer@example.com', name: { given_name: 'Test', surname: 'Buyer' } },
      purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-9', amount: { value: '99.95', currency_code: 'USD' } }] } }],
    });
  }
  if (url.includes('/v1/checkout/sessions')) {
    return json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', payment_status: 'unpaid' });
  }
  return json({ error: 'unexpected url ' + url });
};

function json(obj, status = 200) {
  return { ok: status < 400, status, json: async () => obj };
}

process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_SECRET = 'test-secret';
process.env.PAYPAL_MODE = 'sandbox';
process.env.STRIPE_SECRET_KEY = 'sk_test_123';

const paypal = require('../lib/paypal');
const stripe = require('../lib/stripe');

(async () => {
  const checks = [];
  const ok = (label, cond, detail = '') => {
    checks.push({ label, pass: !!cond, detail });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  };

  ok('paypal.configured() is true with keys', paypal.configured());
  ok('paypal sandbox base url used', paypal.envName() === 'sandbox');

  const order = await paypal.createOrder({
    amount: 99.95,
    currency: 'USD',
    description: 'MIDNIGHT SAFFRON (Trackout Lease)',
    returnUrl: 'http://localhost:3000/checkout/paypal/return?order=abc',
    cancelUrl: 'http://localhost:3000/order/abc',
    referenceId: 'abc123',
  });
  ok('createOrder returns order id', order.id === 'PP-ORDER-1');
  ok('createOrder returns approval url', order.approveUrl.includes('checkoutnow'));

  const createCall = calls.find((c) => c.url.endsWith('/v2/checkout/orders'));
  const sent = JSON.parse(createCall.opts.body);
  ok('order intent is CAPTURE', sent.intent === 'CAPTURE');
  ok('amount serialised to 2dp string', sent.purchase_units[0].amount.value === '99.95');
  ok('currency forwarded', sent.purchase_units[0].amount.currency_code === 'USD');
  ok('no shipping address requested', sent.application_context.shipping_preference === 'NO_SHIPPING');
  ok('return url forwarded', sent.application_context.return_url.includes('/checkout/paypal/return'));
  ok('request id header set for idempotency', createCall.opts.headers['PayPal-Request-Id'] === 'abc123');
  ok('auth uses basic credentials', calls[0].opts.headers.Authorization.startsWith('Basic '));

  const capture = await paypal.captureOrder('PP-ORDER-1');
  ok('capture reports COMPLETED', capture.status === 'COMPLETED');
  ok('capture id parsed', capture.captureId === 'CAPTURE-9');
  ok('payer email parsed', capture.payerEmail === 'buyer@example.com');

  const session = await stripe.createSession({
    items: [
      { amount: 149.95, name: 'MIDNIGHT SAFFRON — Unlimited Lease', description: 'SB-1' },
      { amount: 29.95, name: 'SLOW BURN — Basic Lease', description: 'SB-2' },
    ],
    currency: 'USD',
    successUrl: 'http://localhost:3000/checkout/stripe/success?order=abc&session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'http://localhost:3000/order/abc',
    orderId: 'abc123',
    customerEmail: 'buyer@example.com',
  });
  ok('stripe session url returned', session.url.includes('cs_test_1'));

  const stripeCall = calls.find((c) => c.url.endsWith('/v1/checkout/sessions'));
  const params = new URLSearchParams(stripeCall.opts.body);
  ok('stripe amount in cents', params.get('line_items[0][price_data][unit_amount]') === '14995');
  ok('second line item priced', params.get('line_items[1][price_data][unit_amount]') === '2995');
  ok('stripe mode is payment', params.get('mode') === 'payment');
  ok('order id referenced', params.get('client_reference_id') === 'abc123');
  ok('card data never sent (hosted checkout)', !params.toString().includes('card['));

  // failure shape
  global.fetch = async () => json({ error: 'invalid_client', error_description: 'bad creds' }, 401);
  let threw = '';
  try {
    await paypal.createOrder({ amount: 1, currency: 'USD', description: 'x', returnUrl: 'r', cancelUrl: 'c', referenceId: 'z' });
  } catch (e) {
    threw = e.message;
  }
  ok('auth failure surfaces a clear error', threw.includes('PayPal auth failed'), threw);

  global.fetch = realFetch;
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
