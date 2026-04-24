const prisma = require('../lib/db');
const { callBuild } = require('../lib/locus-build');
const config = require('../lib/config');
const { emit } = require('../lib/sse');
const { sendDropSummary } = require('../lib/email');

const expiryTimers = new Map();
const teardownTimers = new Map();

const VALID_TRANSITIONS = {
  PENDING: ['ACTIVE', 'FAILED'],
  ACTIVE: ['SOLD_OUT', 'ARCHIVED'],
  SOLD_OUT: ['ARCHIVED'],
  ARCHIVED: ['DELETED'],
  FAILED: ['ACTIVE', 'ARCHIVED', 'DELETED'],
};

function canTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) || false;
}

function scheduleExpiry(storeId, endDate) {
  if (expiryTimers.has(storeId)) clearTimeout(expiryTimers.get(storeId));

  const msUntilEnd = new Date(endDate).getTime() - Date.now();
  if (msUntilEnd <= 0) {
    handleExpiry(storeId);
    return;
  }

  const timer = setTimeout(() => handleExpiry(storeId), msUntilEnd);
  expiryTimers.set(storeId, timer);
  console.log(`[Agent3] Expiry scheduled for ${storeId} in ${Math.round(msUntilEnd / 60000)}min`);
}

async function handleExpiry(storeId) {
  expiryTimers.delete(storeId);
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return;
  if (store.status === 'ACTIVE' || store.status === 'SOLD_OUT') {
    await transitionTo(store, 'ARCHIVED');
  }
}

// Handle checkout webhook — now resolves to a specific item
async function handleCheckoutPaid(storeId, webhookData) {
  const result = await prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { id: storeId },
      include: { items: true },
    });
    if (!store || store.status !== 'ACTIVE') {
      console.log(`[Agent3] Ignoring payment for store ${storeId} in status ${store?.status}`);
      return null;
    }

    // Find the item by itemIndex from metadata, or by checkout session
    let item = null;
    if (webhookData.itemId) {
      item = store.items.find(i => i.id === webhookData.itemId);
    } else if (webhookData.itemIndex !== undefined) {
      item = store.items[parseInt(webhookData.itemIndex, 10)];
    } else if (webhookData.checkoutSessionId) {
      item = store.items.find(i => i.checkoutSessionId === webhookData.checkoutSessionId);
    }

    if (!item) {
      // Fallback: first item with inventory remaining
      item = store.items.find(i => i.inventoryRemaining > 0);
    }

    if (!item || item.inventoryRemaining <= 0) {
      console.log(`[Agent3] No inventory for matched item in store ${storeId}`);
      return null;
    }

    // Decrement item inventory
    const updatedItem = await tx.item.update({
      where: { id: item.id },
      data: { inventoryRemaining: { decrement: 1 } },
    });

    // Record transaction
    await tx.transaction.create({
      data: {
        storeId,
        itemId: item.id,
        amountUsdc: item.priceUsdc,
        buyerAddress: webhookData.payerAddress || 'unknown',
        txHash: webhookData.txHash || null,
        status: 'CONFIRMED',
        webhookEventId: webhookData.eventId || `evt_${Date.now()}`,
      },
    });

    return { updatedItem, allItems: store.items, store };
  });

  if (!result) return;

  emit('agent3:sale', {
    storeId,
    itemId: result.updatedItem.id,
    itemName: result.updatedItem.productName,
    remaining: result.updatedItem.inventoryRemaining,
    total: result.updatedItem.inventoryTotal,
  }, storeId);

  // Check if ALL items are sold out
  const freshItems = await prisma.item.findMany({ where: { storeId } });
  const allSoldOut = freshItems.every(i => i.inventoryRemaining <= 0);

  if (allSoldOut) {
    const freshStore = await prisma.store.findUnique({ where: { id: storeId } });
    if (freshStore && freshStore.status === 'ACTIVE') {
      await transitionTo(freshStore, 'SOLD_OUT');
    }
  }
}

async function transitionTo(store, newStatus) {
  if (!canTransition(store.status, newStatus)) {
    console.log(`[Agent3] Blocked transition: ${store.status} -> ${newStatus} for ${store.id}`);
    return;
  }

  console.log(`[Agent3] Transitioning ${store.id}: ${store.status} -> ${newStatus}`);

  switch (newStatus) {
    case 'SOLD_OUT': await handleSoldOut(store); break;
    case 'ARCHIVED': await handleArchived(store); break;
    case 'DELETED': await handleDeleted(store); break;
  }
}

async function handleSoldOut(store) {
  await prisma.store.update({
    where: { id: store.id },
    data: { status: 'SOLD_OUT', soldOutAt: new Date() },
  });
  emit('agent3:transition', { storeId: store.id, newState: 'SOLD_OUT' }, store.id);

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

  // Send summary email if owner provided email
  if (store.ownerEmail) {
    try {
      const fullStore = await prisma.store.findUnique({
        where: { id: store.id },
        include: {
          items: true,
          transactions: { orderBy: { createdAt: 'desc' }, include: { item: true } },
        },
      });
      const sent = await sendDropSummary(fullStore, fullStore.items, fullStore.transactions);
      emit('agent3:email_sent', { storeId: store.id, email: store.ownerEmail, sent }, store.id);
    } catch (err) {
      console.error(`[Agent3] Email failed for ${store.id}:`, err.message);
    }
  }

  if (store.locusServiceId) {
    if (store.postDropAction === 'TEARDOWN') {
      const GRACE_MS = config.isMock ? 5000 : 24 * 60 * 60 * 1000;
      const timer = setTimeout(async () => {
        const fresh = await prisma.store.findUnique({ where: { id: store.id } });
        if (fresh && fresh.status === 'ARCHIVED') await transitionTo(fresh, 'DELETED');
      }, GRACE_MS);
      teardownTimers.set(store.id, timer);
    }
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

async function handleDeleted(store) {
  teardownTimers.delete(store.id);
  if (store.locusServiceId) {
    try {
      await callBuild('DELETE', `/services/${store.locusServiceId}`);
      emit('agent3:service_deleted', { storeId: store.id }, store.id);
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

async function recoverOnStartup() {
  console.log('[Agent3] Recovering state from database...');

  const expiredStores = await prisma.store.findMany({
    where: { status: { in: ['ACTIVE', 'SOLD_OUT'] }, endDate: { lt: new Date() } },
  });
  for (const store of expiredStores) {
    console.log(`[Agent3] Recovering expired store: ${store.id}`);
    await transitionTo(store, 'ARCHIVED');
  }

  const activeStores = await prisma.store.findMany({
    where: { status: { in: ['ACTIVE', 'SOLD_OUT'] }, endDate: { gt: new Date() } },
  });
  for (const store of activeStores) {
    scheduleExpiry(store.id, store.endDate);
  }

  const archivedTeardowns = await prisma.store.findMany({
    where: { status: 'ARCHIVED', postDropAction: 'TEARDOWN' },
  });
  for (const store of archivedTeardowns) {
    const gracePeriod = config.isMock ? 5000 : 24 * 60 * 60 * 1000;
    const archivedAt = store.archivedAt ? store.archivedAt.getTime() : Date.now();
    const msUntilDelete = (archivedAt + gracePeriod) - Date.now();
    if (msUntilDelete <= 0) {
      await transitionTo(store, 'DELETED');
    } else {
      const timer = setTimeout(async () => {
        const fresh = await prisma.store.findUnique({ where: { id: store.id } });
        if (fresh && fresh.status === 'ARCHIVED') await transitionTo(fresh, 'DELETED');
      }, msUntilDelete);
      teardownTimers.set(store.id, timer);
    }
  }

  console.log(`[Agent3] Recovery complete. Active: ${activeStores.length}, Expired: ${expiredStores.length}`);
}

module.exports = { scheduleExpiry, handleCheckoutPaid, handleOverride, recoverOnStartup };
