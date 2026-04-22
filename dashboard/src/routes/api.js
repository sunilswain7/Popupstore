const { Router } = require('express');
const prisma = require('../lib/db');
const { parseInput, validateConfirmedSpec } = require('../agents/agent1-specguard');
const { runBuilder } = require('../agents/agent2-builder');
const { scheduleExpiry } = require('../agents/agent3-lifecycle');
const { emit } = require('../lib/sse');
const { v4: uuidv4 } = require('uuid');

const router = Router();

// Step 1: Parse natural language → structured spec + validation errors
router.post('/drops/parse', async (req, res) => {
  const { input } = req.body;
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return res.status(400).json({ error: 'Please describe your drop' });
  }

  try {
    const { spec, errors } = await parseInput(input.trim());
    res.json({ spec, errors });
  } catch (err) {
    console.error('[Parse] Error:', err.message);
    res.status(500).json({ error: 'Failed to parse input', details: err.message });
  }
});

// Step 2: User reviewed/corrected spec → validate final + launch pipeline
router.post('/drops/confirm', async (req, res) => {
  const { spec, ownerEmail } = req.body;
  if (!spec) {
    return res.status(400).json({ error: 'Missing spec' });
  }

  // Final validation on the user-corrected spec
  const result = validateConfirmedSpec(spec);
  if (result.status !== 'APPROVED') {
    return res.status(400).json({ error: 'Spec has errors', errors: result.errors });
  }

  const storeId = uuidv4();
  res.json({ storeId, message: 'Pipeline started' });

  // Run builder + lifecycle async
  (async () => {
    try {
      emit('agent1:complete', { status: 'APPROVED', spec }, storeId);
      await runBuilder({ status: 'APPROVED', spec, ownerEmail: ownerEmail || null }, storeId);
      scheduleExpiry(storeId, spec.endDate);
    } catch (err) {
      console.error(`[Pipeline] Error for ${storeId}:`, err.message);
    }
  })();
});

// Get all stores with items
router.get('/stores', async (req, res) => {
  const stores = await prisma.store.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      items: true,
      transactions: { orderBy: { createdAt: 'desc' }, take: 10, include: { item: true } },
    },
  });
  res.json({ stores });
});

// Get single store with items and transactions
router.get('/stores/:id', async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { id: req.params.id },
    include: {
      items: true,
      transactions: { orderBy: { createdAt: 'desc' }, include: { item: true } },
    },
  });
  if (!store) return res.status(404).json({ error: 'Store not found' });
  res.json({ store });
});

// Save owner email for a store
router.post('/stores/:id/email', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  try {
    await prisma.store.update({
      where: { id: req.params.id },
      data: { ownerEmail: email },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: 'Store not found' });
  }
});

// Inventory endpoint — returns per-item inventory
router.get('/inventory/:storeId', async (req, res) => {
  const items = await prisma.item.findMany({
    where: { storeId: req.params.storeId },
    select: { id: true, productName: true, inventoryRemaining: true, inventoryTotal: true },
  });
  if (items.length === 0) return res.status(404).json({ error: 'Store not found' });
  res.json({ items });
});

module.exports = router;
