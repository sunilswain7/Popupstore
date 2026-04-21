const { Router } = require('express');
const prisma = require('../lib/db');
const { runSpecGuard } = require('../agents/agent1-specguard');
const { runBuilder } = require('../agents/agent2-builder');
const { scheduleExpiry } = require('../agents/agent3-lifecycle');
const { v4: uuidv4 } = require('uuid');

const router = Router();

// Create a new drop
router.post('/drops', async (req, res) => {
  const { input } = req.body;
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return res.status(400).json({ error: 'Missing input' });
  }

  const storeId = uuidv4();
  res.json({ storeId, message: 'Pipeline started' });

  (async () => {
    try {
      const specResult = await runSpecGuard(input.trim(), storeId);
      if (specResult.status !== 'APPROVED') return;
      await runBuilder(specResult, storeId);
      scheduleExpiry(storeId, specResult.spec.endDate);
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
      transactions: { orderBy: { createdAt: 'desc' }, take: 10 },
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
      transactions: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!store) return res.status(404).json({ error: 'Store not found' });
  res.json({ store });
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
