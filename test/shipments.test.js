import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { app } from '../src/app.js';

let server;
let base;
const realFetch = globalThis.fetch;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.RATES_URL = `${base}/rates/daily.json`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('dispatch manifest totals are expressed in US cents', async () => {
  const shipments = await (await realFetch(`${base}/shipments`)).json();
  assert.equal(shipments.length, 3);
  assert.equal(shipments.reduce((sum, item) => sum + item.charge_usd_cents, 0), 62500);
  const total = await (await realFetch(`${base}/shipments/total`)).json();
  assert.deepEqual(total, { currency: 'USD', total_cents: 62500 });
});

test('the dispatch rate feed serves the daily USD snapshot', async () => {
  const rates = await (await realFetch(`${base}/rates/daily.json`)).json();
  assert.equal(rates.base, 'USD');
  assert.equal(rates.rates.EUR, 0.92);
  assert.equal(rates.rates.CAD, 1.38);
});

test('EUR quotes convert the manifest total and include the rate date', async () => {
  const quote = await (await realFetch(`${base}/shipments/total?currency=EUR`)).json();
  assert.deepEqual(quote, { currency: 'EUR', total_cents: 57500, rate_date: '2026-11-09' });
});

test('CAD quotes convert the manifest total and include the rate date', async () => {
  const quote = await (await realFetch(`${base}/shipments/total?currency=CAD`)).json();
  assert.deepEqual(quote, { currency: 'CAD', total_cents: 86250, rate_date: '2026-11-09' });
});

test('an unsupported currency returns HTTP 400', async () => {
  const response = await realFetch(`${base}/shipments/total?currency=GBP`);
  assert.equal(response.status, 400);
});

test('bill=1 sends the converted quote to Stripe', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: 'qt_test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const previousKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic';

  try {
    const quote = await (await realFetch(`${base}/shipments/total?currency=EUR&bill=1`)).json();
    assert.deepEqual(quote, { currency: 'EUR', total_cents: 57500, rate_date: '2026-11-09' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.stripe.com/v1/quotes');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer sk_test_synthetic');
    const body = new URLSearchParams(calls[0].options.body.toString());
    assert.equal(body.get('shipmentId'), 'manifest');
    assert.equal(body.get('destination'), 'all');
    assert.equal(body.get('totalCents'), '57500');
    assert.equal(body.get('currency'), 'EUR');
  } finally {
    globalThis.fetch = realFetch;
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
  }
});

test('without bill=1 no quote is sent to Stripe', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };
  try {
    await (await realFetch(`${base}/shipments/total?currency=CAD`)).json();
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
