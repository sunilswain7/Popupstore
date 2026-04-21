const prisma = require('../lib/db');
const { callBuild } = require('../lib/locus-build');
const { callLocusPay } = require('../lib/locus-pay');
const config = require('../lib/config');
const { emit } = require('../lib/sse');

async function runBuilder(spec, storeId) {
  if (spec.status !== 'APPROVED') {
    throw new Error('Cannot build: spec not approved');
  }

  const s = spec.spec;

  // Step 0: Balance check
  emit('agent2:start', { message: 'Checking build credits...' }, storeId);
  const balance = await callBuild('GET', '/billing/balance');
  if (balance.creditBalance < 0.25) {
    emit('agent2:error', { reason: 'Insufficient credits', balance: balance.creditBalance }, storeId);
    throw new Error(`Insufficient build credits: $${balance.creditBalance}`);
  }
  emit('agent2:balance_ok', { credits: balance.creditBalance }, storeId);

  // Step 1: Create store + items in DB
  emit('agent2:progress', { message: `Creating drop with ${s.items.length} item(s)...` }, storeId);
  const store = await prisma.store.create({
    data: {
      id: storeId,
      status: 'PENDING',
      dropName: s.dropName,
      endDate: new Date(s.endDate),
      postDropAction: s.postDropAction || 'SOLD_OUT_PAGE',
      locusProjectId: config.storefrontProjectId || null,
    },
  });

  // Create items and checkout sessions
  const itemRecords = [];
  const checkoutUrls = new Map(); // itemId → full checkout URL
  for (let i = 0; i < s.items.length; i++) {
    const item = s.items[i];
    emit('agent2:progress', { message: `Setting up item ${i + 1}/${s.items.length}: ${item.productName}...` }, storeId);

    // Generate image if requested
    let imageUrl = null;
    if (item.generateImage && item.imagePrompt) {
      try {
        const imgResult = await callLocusPay('POST', '/wrapped/fal/generate', {
          prompt: item.imagePrompt,
          model: 'fast-sdxl',
        });
        imageUrl = imgResult.data?.images?.[0]?.url || null;
      } catch (err) {
        console.error(`Image generation failed for item ${i + 1}:`, err.message);
      }
    }

    // Create checkout session for this item
    const checkoutResult = await callLocusPay('POST', '/checkout/sessions', {
      amount: item.price.toString(),
      description: item.productName,
      metadata: { storeId, itemIndex: i.toString() },
      webhookUrl: `${config.dashboardUrl}/webhooks/checkout`,
      successUrl: `${config.dashboardUrl}/stores/${storeId}/thanks`,
      cancelUrl: `${config.dashboardUrl}/stores/${storeId}`,
      expiresInMinutes: 30,
    });
    const checkoutSessionId = checkoutResult.data?.id || `cs_mock_${Date.now()}_${i}`;
    const checkoutUrl = checkoutResult.data?.checkoutUrl || `https://beta.paywithlocus.com/checkout/${checkoutSessionId}`;

    const itemRecord = await prisma.item.create({
      data: {
        storeId,
        productName: item.productName,
        priceUsdc: item.price,
        inventoryTotal: item.inventory,
        inventoryRemaining: item.inventory,
        imageUrl,
        checkoutSessionId,
      },
    });
    checkoutUrls.set(itemRecord.id, checkoutUrl);
    itemRecords.push(itemRecord);
  }

  emit('agent2:items_created', {
    count: itemRecords.length,
    items: itemRecords.map(r => ({ id: r.id, name: r.productName, price: r.priceUsdc })),
  }, storeId);

  // Step 4: Deploy storefront on BuildWithLocus
  emit('agent2:progress', { message: 'Deploying storefront service...' }, storeId);

  const serviceName = `drop-${storeId.substring(0, 8)}`;
  const service = await callBuild('POST', '/services', {
    projectId: config.storefrontProjectId,
    environmentId: config.storefrontEnvId,
    name: serviceName,
    source: {
      type: 'github',
      repo: config.storefrontRepo,
      branch: config.storefrontRepoBranch,
      rootDir: 'storefront',
    },
    runtime: {
      port: 8080,
      cpu: 256,
      memory: 512,
      minInstances: 1,
      maxInstances: 1,
    },
    healthCheckPath: '/',
  });

  const serviceId = service.id;
  const serviceUrl = service.url;
  await prisma.store.update({
    where: { id: storeId },
    data: { locusServiceId: serviceId, locusServiceUrl: serviceUrl },
  });
  emit('agent2:service_created', { serviceId, serviceUrl }, storeId);

  // Inject env vars — items data as JSON for the storefront to read
  emit('agent2:progress', { message: 'Configuring environment variables...' }, storeId);
  const itemsEnv = itemRecords.map(r => ({
    id: r.id,
    productName: r.productName,
    price: r.priceUsdc,
    inventoryTotal: r.inventoryTotal,
    checkoutSessionId: r.checkoutSessionId,
    checkoutUrl: checkoutUrls.get(r.id) || `https://beta.paywithlocus.com/checkout/${r.checkoutSessionId}`,
    imageUrl: r.imageUrl || '',
  }));

  await callBuild('PUT', `/variables/service/${serviceId}`, {
    variables: {
      STORE_ID: storeId,
      DROP_NAME: s.dropName,
      ITEMS_JSON: JSON.stringify(itemsEnv),
      INVENTORY_API_URL: `${config.dashboardUrl}/api/inventory/${storeId}`,
      DROP_STATUS: 'ACTIVE',
      POST_DROP_ACTION: s.postDropAction || 'SOLD_OUT_PAGE',
      END_DATE: s.endDate,
    },
  });

  // Trigger deployment
  emit('agent2:progress', { message: 'Triggering deployment (3-7 min for source builds)...' }, storeId);
  const deployment = await callBuild('POST', '/deployments', { serviceId });
  const deploymentId = deployment.id;
  await prisma.store.update({ where: { id: storeId }, data: { locusDeploymentId: deploymentId } });
  emit('agent2:deploy_started', { deploymentId, serviceId }, storeId);

  // Monitor deployment
  const finalStatus = await monitorDeployment(deploymentId, storeId);

  if (finalStatus === 'failed') {
    await prisma.store.update({ where: { id: storeId }, data: { status: 'FAILED' } });
    emit('agent2:deploy_failed', { deploymentId }, storeId);
    throw new Error('Deployment failed');
  }

  // Finalize
  await prisma.store.update({
    where: { id: storeId },
    data: { status: 'ACTIVE', activatedAt: new Date() },
  });

  emit('agent2:store_live', { url: serviceUrl, storeId, itemCount: itemRecords.length }, storeId);
  return { storeId, serviceId, serviceUrl, deploymentId };
}

async function monitorDeployment(deploymentId, storeId) {
  const TERMINAL = ['healthy', 'failed', 'cancelled', 'rolled_back'];
  const MAX_POLLS = 20;
  const POLL_INTERVAL = config.isMock ? 100 : 30000;

  for (let i = 0; i < MAX_POLLS; i++) {
    const data = await callBuild('GET', `/deployments/${deploymentId}`);
    const status = data.status || 'unknown';
    emit('agent2:deploy_status', { status, poll: i + 1 }, storeId);
    if (TERMINAL.includes(status)) return status;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  return 'timeout';
}

module.exports = { runBuilder };
