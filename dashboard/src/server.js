const express = require('express');
const path = require('path');
const config = require('./lib/config');
const { addClient } = require('./lib/sse');
const { recoverOnStartup } = require('./agents/agent3-lifecycle');
const apiRoutes = require('./routes/api');
const overrideRoutes = require('./routes/overrides');

const app = express();

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS for storefront → dashboard API calls
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/health', (req, res) => res.send('healthy'));

app.get('/', (req, res) => {
  if (req.headers.accept?.includes('text/html')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  res.json({ status: 'ok', service: 'popupstore-dashboard', mock: config.isMock });
});

// Static files (after explicit routes so / handler takes priority)
app.use(express.static(path.join(__dirname, '..', 'public')));

// SSE endpoint
app.get('/events', (req, res) => {
  addClient(res, null); // global
});

app.get('/events/:storeId', (req, res) => {
  addClient(res, req.params.storeId);
});

// Webhook endpoint (raw body for HMAC)
app.post('/webhooks/checkout', express.raw({ type: '*/*' }), async (req, res) => {
  const crypto = require('crypto');
  const { handleCheckoutPaid } = require('./agents/agent3-lifecycle');

  const signature = req.headers['x-signature-256'];
  if (signature && config.webhookSecret !== 'dev-secret') {
    const bodyStr = typeof req.body === 'string' ? req.body : req.body.toString();
    const expected = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(bodyStr)
      .digest('hex');

    const sigHex = signature.replace('sha256=', '');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sigHex, 'hex'), Buffer.from(expected, 'hex'))) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid signature format' });
    }
  }

  try {
    const bodyStr = typeof req.body === 'string' ? req.body : req.body.toString();
    const payload = JSON.parse(bodyStr);
    const event = payload.event || payload.type;

    if (event === 'checkout.session.paid') {
      const data = payload.data || payload;
      const storeId = data.metadata?.storeId;
      if (!storeId) return res.status(400).json({ error: 'Missing storeId' });

      await handleCheckoutPaid(storeId, {
        payerAddress: data.payerAddress || data.payer_address || 'unknown',
        txHash: data.txHash || data.tx_hash || null,
        eventId: payload.id || `evt_${Date.now()}`,
      });
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Pretty URL proxy — /s/:slug serves the storefront inline
app.get('/s/:slug', async (req, res) => {
  try {
    const prisma = require('./lib/db');
    const store = await prisma.store.findUnique({ where: { slug: req.params.slug } });
    if (!store || !store.locusServiceUrl) return res.status(404).send('Store not found');
    const response = await fetch(store.locusServiceUrl);
    const html = await response.text();
    res.type('html').send(html);
  } catch (err) {
    console.error('[Slug Proxy] Error:', err.message);
    res.status(502).send('Could not load store');
  }
});

app.get('/s/:slug/api/:path(*)', async (req, res) => {
  try {
    const prisma = require('./lib/db');
    const store = await prisma.store.findUnique({ where: { slug: req.params.slug } });
    if (!store || !store.locusServiceUrl) return res.status(404).json({ error: 'Not found' });
    const response = await fetch(`${store.locusServiceUrl}/api/${req.params.path}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[Slug Proxy] API error:', err.message);
    res.status(502).json({ error: 'Could not load store data' });
  }
});

// API routes
app.use('/api', apiRoutes);
app.use('/api', overrideRoutes);

// Thank you page
app.get('/stores/:id/thanks', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>Thank You!</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #fff;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { text-align: center; max-width: 400px; }
  h1 { color: #22c55e; margin-bottom: 1rem; }
  a { color: #3b82f6; }
</style></head>
<body><div class="card">
  <h1>Payment Successful!</h1>
  <p>Your purchase is confirmed. The transaction is being processed on-chain.</p>
  <p style="margin-top:1rem"><a href="/stores/${req.params.id}">Back to drop</a></p>
</div></body></html>`);
});

// Start server
app.listen(config.port, async () => {
  console.log(`PopupStore Dashboard listening on port ${config.port}`);
  console.log(`Mock mode: ${config.isMock}`);

  // Agent 3: Recover state from DB
  try {
    await recoverOnStartup();
  } catch (err) {
    console.error('[Startup] Agent 3 recovery failed:', err.message);
  }
});
