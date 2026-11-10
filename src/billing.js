export async function sendQuote({ shipmentId, destination, totalCents, currency }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required for billing');

  const response = await fetch('https://api.stripe.com/v1/quotes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ shipmentId, destination, totalCents, currency }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Billing quote request failed');
}
