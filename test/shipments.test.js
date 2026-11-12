import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';

let server;
let base;
let originalRatesUrl;
let billingError;
const quotes = [];

before(async () => {
  const app = createApp({
    quoteSender: async (quote) => {
      if (billingError) throw billingError;
      quotes.push(quote);
    },
  });
  // Extra rate snapshots used to exercise error and rounding paths locally.
  app.get('/rates/broken', (_req, res) => res.status(503).end());
  app.get('/rates/invalid', (_req, res) => res.json({ base: 'USD', date: 'bad', rates: { EUR: 0.92 } }));
  app.get('/rates/rounding', (_req, res) => res.json({ base: 'USD', date: '2026-11-09', rates: { EUR: 0.920008 } }));

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  originalRatesUrl = process.env.RATES_URL;
  process.env.RATES_URL = `${base}/rates/daily.json`;
});

after(() => {
  if (originalRatesUrl === undefined) delete process.env.RATES_URL;
  else process.env.RATES_URL = originalRatesUrl;
  return new Promise((resolve) => server.close(resolve));
});

test('dispatch manifest totals are expressed in US cents', async () => {
  const shipments = await (await fetch(`${base}/shipments`)).json();
  assert.equal(shipments.length, 3);
  assert.equal(shipments.reduce((sum, item) => sum + item.charge_usd_cents, 0), 62500);
  const total = await (await fetch(`${base}/shipments/total`)).json();
  assert.deepEqual(total, { currency: 'USD', total_cents: 62500 });
});

test('the dispatch rate feed serves the daily USD snapshot', async () => {
  const rates = await (await fetch(`${base}/rates/daily.json`)).json();
  assert.equal(rates.base, 'USD');
  assert.equal(rates.rates.EUR, 0.92);
  assert.equal(rates.rates.CAD, 1.38);
});

for (const [currency, totalCents] of [['EUR', 57500], ['CAD', 86250]]) {
  test(`the manifest converts to ${currency} using the local snapshot`, async () => {
    const response = await fetch(`${base}/shipments/total?currency=${currency}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { currency, total_cents: totalCents, date: '2026-11-09' });
    assert.equal(quotes.length, 0);
  });
}

test('unsupported, lowercase and repeated currencies return HTTP 400', async () => {
  for (const query of ['currency=GBP', 'currency=eur', 'currency=', 'currency=EUR&currency=CAD']) {
    const response = await fetch(`${base}/shipments/total?${query}&bill=1`);
    assert.equal(response.status, 400);
  }
  assert.equal(quotes.length, 0);
});

test('explicit USD keeps the existing response even with bill=1', async () => {
  const response = await fetch(`${base}/shipments/total?currency=USD&bill=1`);
  assert.deepEqual(await response.json(), { currency: 'USD', total_cents: 62500 });
  assert.equal(quotes.length, 0);
});

test('conversions round once after summing the manifest', async () => {
  process.env.RATES_URL = `${base}/rates/rounding`;
  try {
    const response = await fetch(`${base}/shipments/total?currency=EUR`);
    assert.equal((await response.json()).total_cents, 57501);
  } finally {
    process.env.RATES_URL = `${base}/rates/daily.json`;
  }
});

test('failed or invalid rate sheets return HTTP 502 without billing', async () => {
  try {
    for (const path of ['broken', 'invalid']) {
      process.env.RATES_URL = `${base}/rates/${path}`;
      const response = await fetch(`${base}/shipments/total?currency=EUR&bill=1`);
      assert.equal(response.status, 502);
    }
    assert.equal(quotes.length, 0);
  } finally {
    process.env.RATES_URL = `${base}/rates/daily.json`;
  }
});

test('only bill=1 sends the converted manifest quote', async () => {
  await fetch(`${base}/shipments/total?currency=EUR&bill=0`);
  assert.equal(quotes.length, 0);

  const shipments = await (await fetch(`${base}/shipments`)).json();
  for (const [currency, totalCents] of [['EUR', 57500], ['CAD', 86250]]) {
    const response = await fetch(`${base}/shipments/total?currency=${currency}&bill=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(quotes.at(-1), {
      shipmentId: 'manifest',
      destination: shipments.map((shipment) => shipment.destination).join(', '),
      totalCents,
      currency,
    });
  }
  assert.equal(quotes.length, 2);
});

test('billing failures return HTTP 502', async () => {
  billingError = new Error('test billing failure');
  try {
    const response = await fetch(`${base}/shipments/total?currency=EUR&bill=1`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Unable to prepare converted quote' });
  } finally {
    billingError = undefined;
  }
});
