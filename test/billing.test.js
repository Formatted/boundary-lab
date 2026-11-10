import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sendQuote } from '../src/billing.js';

test('billing posts the quote with authentication and handles failures without contacting Stripe', async (t) => {
  const oldKey = process.env.STRIPE_SECRET_KEY;
  const testKey = randomUUID();
  const calls = [];
  let ok = true;
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args);
    return { ok };
  });
  const quote = { shipmentId: 'manifest', destination: 'test destination', totalCents: 57500, currency: 'EUR' };
  try {
    process.env.STRIPE_SECRET_KEY = testKey;
    await sendQuote(quote);
    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(url, 'https://api.stripe.com/v1/quotes');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${testKey}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), quote);

    ok = false;
    await assert.rejects(sendQuote(quote), /Billing quote request failed/);
    delete process.env.STRIPE_SECRET_KEY;
    await assert.rejects(sendQuote(quote), /STRIPE_SECRET_KEY is required/);
    assert.equal(calls.length, 2);
  } finally {
    if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldKey;
  }
});
