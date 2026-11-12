import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';
import { sendQuote } from './billing.js';

// The dispatch export contains three unquoted columns and integer charges in US cents.
const manifest = readFileSync(new URL('../fixtures/shipments.csv', import.meta.url), 'utf8');
const shipments = manifest.trim().split(/\r?\n/).slice(1).map((row) => {
  const [id, destination, cents] = row.split(',');
  return { id, destination, charge_usd_cents: Number(cents) };
});
const rateSheet = fileURLToPath(new URL('../fixtures/daily-rates.json', import.meta.url));

const defaultRatesUrl = 'http://127.0.0.1:4300/rates/daily.json';
const supportedCurrencies = new Set(['EUR', 'CAD']);

export const app = express();
app.get('/shipments', (_req, res) => res.json(shipments));
app.get('/shipments/total', async (req, res) => {
  const total = shipments.reduce((sum, shipment) => sum + shipment.charge_usd_cents, 0);
  const currency = req.query.currency;

  if (currency === undefined || currency === 'USD') {
    res.json({ currency: 'USD', total_cents: total });
    return;
  }

  if (!supportedCurrencies.has(currency)) {
    res.status(400).json({ error: `Unsupported currency: ${currency}` });
    return;
  }

  const ratesUrl = process.env.RATES_URL || defaultRatesUrl;
  const response = await fetch(ratesUrl);
  if (!response.ok) {
    throw new Error(`Rate sheet request failed with HTTP ${response.status}`);
  }
  const sheet = await response.json();
  const rate = sheet.rates?.[currency];
  if (typeof rate !== 'number') {
    res.status(400).json({ error: `No rate available for ${currency}` });
    return;
  }

  // Convert in one step and round once to integer cents.
  const totalCents = Math.round(total * rate);
  const quote = { currency, total_cents: totalCents, rate_date: sheet.date };

  if (req.query.bill === '1') {
    await sendQuote({
      shipmentId: 'manifest',
      destination: 'all',
      totalCents,
      currency,
    });
  }

  res.json(quote);
});
app.get('/rates/daily.json', (_req, res) => res.sendFile(rateSheet));
