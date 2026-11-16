const { PayOS } = require('@payos/node');

/*
 * Method shapes below were checked against the installed @payos/node@2.0.6 type
 * definitions (lib/resources/v2/payment-requests/payment-requests.d.ts and
 * lib/resources/webhooks/webhook.d.ts), not guessed — re-check them if this package
 * gets upgraded.
 */
const payos = new PayOS({
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY,
});

async function createTopupLink({ orderCode, amount, phone }) {
  const base = process.env.PUBLIC_BASE_URL;
  return payos.paymentRequests.create({
    orderCode,
    amount,
    description: `Nap vi ${phone}`.slice(0, 25), // payOS limits description length; keep it short
    returnUrl: `${base}/dat-don.html?topup=done`,
    cancelUrl: `${base}/dat-don.html?topup=cancelled`,
  });
}

/** Throws if the signature doesn't check out — never trust an unverified webhook body. */
async function verifyWebhook(webhookBody) {
  return payos.webhooks.verify(webhookBody);
}

module.exports = { payos, createTopupLink, verifyWebhook };
