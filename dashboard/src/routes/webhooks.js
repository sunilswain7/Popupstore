const { Router } = require('express');
const crypto = require('crypto');
const config = require('../lib/config');
const { handleCheckoutPaid } = require('../agents/agent3-lifecycle');

const router = Router();

// Checkout webhook — receives payment notifications from PayWithLocus
router.post('/checkout', express.raw({ type: 'application/json' }), async (req, res) => {
  // HMAC verification
  const signature = req.headers['x-signature-256'];
  if (signature && config.webhookSecret !== 'dev-secret') {
    const expected = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
      .digest('hex');

    const sigHex = signature.replace('sha256=', '');
    if (!crypto.timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expected, 'hex'))) {
      console.log('[Webhook] Invalid HMAC signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const event = payload.event || payload.type;

    if (event === 'checkout.session.paid') {
      const data = payload.data || payload;
      const storeId = data.metadata?.storeId;

      if (!storeId) {
        console.log('[Webhook] Missing storeId in metadata');
        return res.status(400).json({ error: 'Missing storeId' });
      }

      await handleCheckoutPaid(storeId, {
        payerAddress: data.payerAddress || data.payer_address,
        txHash: data.txHash || data.tx_hash,
        eventId: payload.id || `evt_${Date.now()}`,
      });
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;

// Need express for express.raw middleware
const express = require('express');
