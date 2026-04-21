const { Router } = require('express');
const { handleOverride } = require('../agents/agent3-lifecycle');

const router = Router();

// Manual override for store lifecycle
router.post('/stores/:id/override', async (req, res) => {
  const { action } = req.body;
  if (!action || !['ARCHIVE', 'DELETE'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be ARCHIVE or DELETE' });
  }

  try {
    await handleOverride(req.params.id, action);
    res.json({ success: true, action });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
