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

export function createApp({ quoteSender = sendQuote } = {}) {
  const app = express();
  app.get('/shipments', (_req, res) => res.json(shipments));
  app.get('/shipments/total', async (req, res) => {
    const currency = req.query.currency ?? 'USD';
    if (!['USD', 'EUR', 'CAD'].includes(currency)) {
      return res.status(400).json({ error: 'Unsupported currency' });
    }
    const total = shipments.reduce((sum, shipment) => sum + shipment.charge_usd_cents, 0);
    if (currency === 'USD') return res.json({ currency: 'USD', total_cents: total });

    try {
      const response = await fetch(process.env.RATES_URL || 'http://127.0.0.1:4300/rates/daily.json', {
        timeout: 5000,
      });
      if (!response.ok) throw new Error('Rate sheet request failed');
      const sheet = await response.json();
      const rate = sheet.rates?.[currency];
      const date = new Date(sheet.date);
      if (sheet.base !== 'USD' || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 ||
          typeof sheet.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(sheet.date) ||
          !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== sheet.date) {
        throw new Error('Invalid rate sheet');
      }
      const totalCents = Math.round(total * rate);
      if (!Number.isSafeInteger(totalCents)) throw new Error('Invalid converted total');
      if (req.query.bill === '1') {
        await quoteSender({
          shipmentId: 'manifest',
          destination: shipments.map((shipment) => shipment.destination).join(', '),
          totalCents,
          currency,
        });
      }
      return res.json({ currency, total_cents: totalCents, date: date.toISOString().slice(0, 10) });
    } catch {
      return res.status(502).json({ error: 'Unable to prepare converted quote' });
    }
  });
  app.get('/rates/daily.json', (_req, res) => res.sendFile(rateSheet));
  return app;
}

export const app = createApp();
