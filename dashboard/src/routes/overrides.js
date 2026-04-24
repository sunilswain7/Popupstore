const { Router } = require('express');
const { handleOverride, scheduleExpiry } = require('../agents/agent3-lifecycle');
const prisma = require('../lib/db');

const router = Router();

// Manual override for store lifecycle
router.post('/stores/:id/override', async (req, res) => {
  const { action } = req.body;
  if (!action || !['ARCHIVE', 'DELETE', 'REACTIVATE'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be ARCHIVE, DELETE, or REACTIVATE' });
  }

  try {
    if (action === 'REACTIVATE') {
      const store = await prisma.store.findUnique({ where: { id: req.params.id } });
      if (!store) return res.status(404).json({ error: 'Store not found' });
      if (store.status !== 'FAILED') return res.status(400).json({ error: `Cannot reactivate from ${store.status}` });
      await prisma.store.update({
        where: { id: store.id },
        data: { status: 'ACTIVE', activatedAt: new Date() },
      });
      scheduleExpiry(store.id, store.endDate);
      return res.json({ success: true, action: 'REACTIVATE' });
    }

    await handleOverride(req.params.id, action);
    res.json({ success: true, action });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
