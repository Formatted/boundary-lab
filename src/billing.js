// Send a converted shipment quote to Stripe.
const STRIPE_QUOTE_URL = 'https://api.stripe.com/v1/quotes';

export async function sendQuote({ shipmentId, destination, totalCents, currency }) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set');

  const body = new URLSearchParams({
    shipmentId,
    destination,
    totalCents: String(totalCents),
    currency,
  });

  const response = await fetch(STRIPE_QUOTE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Stripe quote failed with HTTP ${response.status}`);
  }

  return response.json();
}
