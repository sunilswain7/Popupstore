const prisma = require('../lib/db');
const { callBuild } = require('../lib/locus-build');
const config = require('../lib/config');
const { emit } = require('../lib/sse');

// In-memory timers for expiry — recovered from DB on startup
const expiryTimers = new Map();
const teardownTimers = new Map();

// Valid state transitions
const VALID_TRANSITIONS = {
  PENDING: ['ACTIVE', 'FAILED'],
  ACTIVE: ['SOLD_OUT', 'ARCHIVED'],
  SOLD_OUT: ['ARCHIVED'],
  ARCHIVED: ['DELETED'],
};

function canTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) || false;
}

// Schedule expiry timer for a store
function scheduleExpiry(storeId, endDate) {
  if (expiryTimers.has(storeId)) clearTimeout(expiryTimers.get(storeId));

  const msUntilEnd = new Date(endDate).getTime() - Date.now();
  if (msUntilEnd <= 0) {
    // Already expired — handle immediately
    handleExpiry(storeId);
    return;
  }

  const timer = setTimeout(() => handleExpiry(storeId), msUntilEnd);
  expiryTimers.set(storeId, timer);
  console.log(`[Agent3] Expiry scheduled for ${storeId} in ${Math.round(msUntilEnd / 60000)}min`);
}

// Handle drop expiry
async function handleExpiry(storeId) {
  expiryTimers.delete(storeId);

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return;

  if (store.status === 'ACTIVE' || store.status === 'SOLD_OUT') {
    await transitionTo(store, 'ARCHIVED');
  }
}

// Handle checkout webhook (payment received)
async function handleCheckoutPaid(storeId, webhookData) {
  // Use transaction for atomic inventory decrement
  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: storeId } });
    if (!store || store.status !== 'ACTIVE') {
      console.log(`[Agent3] Ignoring payment for store ${storeId} in status ${store?.status}`);
      return null;
    }

    if (store.inventoryRemaining <= 0) {
      console.log(`[Agent3] No inventory left for store ${storeId}`);
      return null;
    }

    // Decrement inventory
    const updated = await tx.store.update({
      where: { id: storeId },
      data: { inventoryRemaining: { decrement: 1 } },
    });

    // Record transaction
    await tx.transaction.create({
      data: {
        storeId,
        amountUsdc: store.priceUsdc,
        buyerAddress: webhookData.payerAddress || 'unknown',
        txHash: webhookData.txHash || null,
        status: 'CONFIRMED',
        webhookEventId: webhookData.eventId || `evt_${Date.now()}`,
      },
    });

    return updated;
  });

  if (!result) return;

  emit('agent3:sale', {
    storeId,
    remaining: result.inventoryRemaining,
    total: result.inventoryTotal,
  }, storeId);

  // Check if sold out
  if (result.inventoryRemaining <= 0) {
    const freshStore = await prisma.store.findUnique({ where: { id: storeId } });
    if (freshStore && freshStore.status === 'ACTIVE') {
      await transitionTo(freshStore, 'SOLD_OUT');
    }
  }
}

// Core state transition handler
async function transitionTo(store, newStatus) {
  if (!canTransition(store.status, newStatus)) {
    console.log(`[Agent3] Blocked transition: ${store.status} -> ${newStatus} for ${store.id}`);
    return;
  }

  console.log(`[Agent3] Transitioning ${store.id}: ${store.status} -> ${newStatus}`);

  switch (newStatus) {
    case 'SOLD_OUT':
      await handleSoldOut(store);
      break;
    case 'ARCHIVED':
      await handleArchived(store);
      break;
    case 'DELETED':
      await handleDeleted(store);
      break;
  }
}

async function handleSoldOut(store) {
  await prisma.store.update({
    where: { id: store.id },
    data: { status: 'SOLD_OUT', soldOutAt: new Date() },
  });

  emit('agent3:transition', { storeId: store.id, newState: 'SOLD_OUT' }, store.id);

  // Update storefront env vars & redeploy
  if (store.locusServiceId) {
    const vars = { DROP_STATUS: 'SOLD_OUT' };
    if (store.postDropAction === 'WAITLIST') vars.SHOW_WAITLIST = 'true';

    try {
      await callBuild('PATCH', `/variables/service/${store.locusServiceId}`, { variables: vars });
      await callBuild('POST', '/deployments', { serviceId: store.locusServiceId });
      emit('agent3:redeploy', { storeId: store.id, reason: 'SOLD_OUT' }, store.id);
    } catch (err) {
      console.error(`[Agent3] Redeploy failed for ${store.id}:`, err.message);
    }
  }
}

async function handleArchived(store) {
  await prisma.store.update({
    where: { id: store.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  });

  emit('agent3:transition', { storeId: store.id, newState: 'ARCHIVED' }, store.id);

  if (store.locusServiceId) {
    if (store.postDropAction === 'TEARDOWN') {
      // Schedule deletion after 24h grace period
      const GRACE_MS = config.isMock ? 5000 : 24 * 60 * 60 * 1000;
      const timer = setTimeout(async () => {
        const fresh = await prisma.store.findUnique({ where: { id: store.id } });
        if (fresh && fresh.status === 'ARCHIVED') {
          await transitionTo(fresh, 'DELETED');
        }
      }, GRACE_MS);
      teardownTimers.set(store.id, timer);

      // Still update the storefront to show archived
      try {
        await callBuild('PATCH', `/variables/service/${store.locusServiceId}`, {
          variables: { DROP_STATUS: 'ARCHIVED' },
        });
        await callBuild('POST', '/deployments', { serviceId: store.locusServiceId });
      } catch (err) {
        console.error(`[Agent3] Archive redeploy failed:`, err.message);
      }
    } else {
      // SOLD_OUT_PAGE or WAITLIST — keep running with archived status
      try {
        await callBuild('PATCH', `/variables/service/${store.locusServiceId}`, {
          variables: { DROP_STATUS: 'ARCHIVED' },
        });
        await callBuild('POST', '/deployments', { serviceId: store.locusServiceId });
      } catch (err) {
        console.error(`[Agent3] Archive redeploy failed:`, err.message);
      }
    }
  }
}

async function handleDeleted(store) {
  teardownTimers.delete(store.id);

  // Delete the Locus service
  if (store.locusServiceId) {
    try {
      await callBuild('DELETE', `/services/${store.locusServiceId}`);
      emit('agent3:service_deleted', { storeId: store.id, serviceId: store.locusServiceId }, store.id);
    } catch (err) {
      console.error(`[Agent3] Service deletion failed:`, err.message);
    }
  }

  await prisma.store.update({
    where: { id: store.id },
    data: { status: 'DELETED', deletedAt: new Date() },
  });

  emit('agent3:transition', { storeId: store.id, newState: 'DELETED' }, store.id);
}

// Manual override (from dashboard UI)
async function handleOverride(storeId, action) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error('Store not found');

  switch (action) {
    case 'ARCHIVE':
      if (!canTransition(store.status, 'ARCHIVED')) throw new Error(`Cannot archive from ${store.status}`);
      await transitionTo(store, 'ARCHIVED');
      break;
    case 'DELETE':
      if (!canTransition(store.status, 'DELETED')) throw new Error(`Cannot delete from ${store.status}`);
      await transitionTo(store, 'DELETED');
      break;
    default:
      throw new Error(`Unknown override action: ${action}`);
  }
}

// Recover state on startup — scan DB for stores that need attention
async function recoverOnStartup() {
  console.log('[Agent3] Recovering state from database...');

  // Find active/sold_out stores with expired endDate
  const expiredStores = await prisma.store.findMany({
    where: {
      status: { in: ['ACTIVE', 'SOLD_OUT'] },
      endDate: { lt: new Date() },
    },
  });

  for (const store of expiredStores) {
    console.log(`[Agent3] Recovering expired store: ${store.id}`);
    await transitionTo(store, 'ARCHIVED');
  }

  // Schedule expiry timers for active stores not yet expired
  const activeStores = await prisma.store.findMany({
    where: {
      status: { in: ['ACTIVE', 'SOLD_OUT'] },
      endDate: { gt: new Date() },
    },
  });

  for (const store of activeStores) {
    scheduleExpiry(store.id, store.endDate);
  }

  // Recover teardown timers for archived stores with TEARDOWN action
  const archivedTeardowns = await prisma.store.findMany({
    where: {
      status: 'ARCHIVED',
      postDropAction: 'TEARDOWN',
    },
  });

  for (const store of archivedTeardowns) {
    const gracePeriod = config.isMock ? 5000 : 24 * 60 * 60 * 1000;
    const archivedAt = store.archivedAt ? store.archivedAt.getTime() : Date.now();
    const deleteAt = archivedAt + gracePeriod;
    const msUntilDelete = deleteAt - Date.now();

    if (msUntilDelete <= 0) {
      await transitionTo(store, 'DELETED');
    } else {
      const timer = setTimeout(async () => {
        const fresh = await prisma.store.findUnique({ where: { id: store.id } });
        if (fresh && fresh.status === 'ARCHIVED') {
          await transitionTo(fresh, 'DELETED');
        }
      }, msUntilDelete);
      teardownTimers.set(store.id, timer);
    }
  }

  console.log(`[Agent3] Recovery complete. Active: ${activeStores.length}, Expired: ${expiredStores.length}`);
}

module.exports = { scheduleExpiry, handleCheckoutPaid, handleOverride, recoverOnStartup };
