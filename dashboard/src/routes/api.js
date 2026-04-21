const { Router } = require('express');
const prisma = require('../lib/db');
const { runSpecGuard } = require('../agents/agent1-specguard');
const { runBuilder } = require('../agents/agent2-builder');
const { scheduleExpiry } = require('../agents/agent3-lifecycle');
const { v4: uuidv4 } = require('uuid');

const router = Router();

// Create a new drop — triggers the full 3-agent pipeline
router.post('/drops', async (req, res) => {
  const { input } = req.body;
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return res.status(400).json({ error: 'Missing input' });
  }

  const storeId = uuidv4();

  // Run pipeline async — SSE will deliver progress
  res.json({ storeId, message: 'Pipeline started' });

  // Agent pipeline (async, non-blocking)
  (async () => {
    try {
      // Agent 1: Parse & validate
      const specResult = await runSpecGuard(input.trim(), storeId);
      if (specResult.status !== 'APPROVED') return;

      // Agent 2: Build & deploy
      const buildResult = await runBuilder(specResult, storeId);

      // Hand off to Agent 3: schedule expiry
      scheduleExpiry(storeId, specResult.spec.endDate);
    } catch (err) {
      console.error(`[Pipeline] Error for ${storeId}:`, err.message);
    }
  })();
});

// Get all stores
router.get('/stores', async (req, res) => {
  const stores = await prisma.store.findMany({
    orderBy: { createdAt: 'desc' },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
  });
  res.json({ stores });
});

// Get single store
router.get('/stores/:id', async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { id: req.params.id },
    include: { transactions: { orderBy: { createdAt: 'desc' } } },
  });
  if (!store) return res.status(404).json({ error: 'Store not found' });
  res.json({ store });
});

// Inventory endpoint (called by storefront)
router.get('/inventory/:storeId', async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { id: req.params.storeId },
    select: { inventoryRemaining: true, inventoryTotal: true },
  });
  if (!store) return res.status(404).json({ error: 'Store not found' });
  res.json({ remaining: store.inventoryRemaining, total: store.inventoryTotal });
});

module.exports = router;
