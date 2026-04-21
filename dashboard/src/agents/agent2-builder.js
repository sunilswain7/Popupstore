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
  if (balance.creditBalance < 0.50) {
    emit('agent2:error', { reason: 'Insufficient credits', balance: balance.creditBalance }, storeId);
    throw new Error(`Insufficient build credits: $${balance.creditBalance}`);
  }
  emit('agent2:balance_ok', { credits: balance.creditBalance }, storeId);

  // Step 1: Create DB record
  emit('agent2:progress', { message: 'Creating store record...' }, storeId);
  const store = await prisma.store.create({
    data: {
      id: storeId,
      status: 'PENDING',
      productName: s.productName,
      priceUsdc: s.price,
      inventoryTotal: s.inventory,
      inventoryRemaining: s.inventory,
      endDate: new Date(s.endDate),
      postDropAction: s.postDropAction,
      locusProjectId: config.storefrontProjectId || null,
    },
  });
  emit('agent2:db_record_created', { storeId: store.id }, storeId);

  // Step 2: Generate image (optional)
  let imageUrl = null;
  if (s.generateImage && s.imagePrompt) {
    emit('agent2:progress', { message: 'Generating product image...' }, storeId);
    try {
      const imgResult = await callLocusPay('POST', '/wrapped/fal/generate', {
        prompt: s.imagePrompt,
        model: 'fast-sdxl',
      });
      imageUrl = imgResult.data?.images?.[0]?.url || null;
      if (imageUrl) {
        await prisma.store.update({ where: { id: storeId }, data: { imageUrl } });
      }
    } catch (err) {
      console.error('Image generation failed, continuing without image:', err.message);
      emit('agent2:warning', { message: 'Image generation failed, continuing without image' }, storeId);
    }
  }

  // Step 3: Create checkout session
  emit('agent2:progress', { message: 'Creating checkout session...' }, storeId);
  const checkoutResult = await callLocusPay('POST', '/checkout/sessions', {
    amount: s.price.toString(),
    description: s.productName,
    metadata: { storeId },
    webhookUrl: `${config.dashboardUrl}/webhooks/checkout`,
    successUrl: `${config.dashboardUrl}/stores/${storeId}/thanks`,
    cancelUrl: `${config.dashboardUrl}/stores/${storeId}`,
    expiresInMinutes: 30,
  });
  const checkoutSessionId = checkoutResult.data?.id || `cs_mock_${Date.now()}`;
  await prisma.store.update({ where: { id: storeId }, data: { checkoutSessionId } });
  emit('agent2:checkout_created', { checkoutSessionId }, storeId);

  // Step 4: Deploy storefront on BuildWithLocus
  emit('agent2:progress', { message: 'Deploying storefront service...' }, storeId);

  // 4b. Create service
  const serviceName = `drop-${storeId.substring(0, 8)}`;
  const service = await callBuild('POST', '/services', {
    projectId: config.storefrontProjectId,
    environmentId: config.storefrontEnvId,
    name: serviceName,
    source: {
      type: 'github',
      repo: config.storefrontRepo,
      branch: config.storefrontRepoBranch,
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

  // 4c. Inject env vars
  emit('agent2:progress', { message: 'Configuring environment variables...' }, storeId);
  await callBuild('PUT', `/variables/service/${serviceId}`, {
    variables: {
      STORE_ID: storeId,
      PRODUCT_NAME: s.productName,
      PRICE_USDC: s.price.toString(),
      INVENTORY_TOTAL: s.inventory.toString(),
      CHECKOUT_SESSION_ID: checkoutSessionId,
      INVENTORY_API_URL: `${config.dashboardUrl}/api/inventory/${storeId}`,
      DROP_STATUS: 'ACTIVE',
      POST_DROP_ACTION: s.postDropAction,
      END_DATE: s.endDate,
      IMAGE_URL: imageUrl || '',
      CHECKOUT_BASE_URL: 'https://beta.paywithlocus.com/checkout',
    },
  });

  // 4d. Trigger deployment
  emit('agent2:progress', { message: 'Triggering deployment (3-7 min for source builds)...' }, storeId);
  const deployment = await callBuild('POST', '/deployments', {
    serviceId,
  });
  const deploymentId = deployment.id;
  await prisma.store.update({ where: { id: storeId }, data: { locusDeploymentId: deploymentId } });
  emit('agent2:deploy_started', { deploymentId, serviceId }, storeId);

  // 4e. Monitor deployment (non-blocking poll)
  const finalStatus = await monitorDeployment(deploymentId, storeId);

  if (finalStatus === 'failed') {
    await prisma.store.update({ where: { id: storeId }, data: { status: 'FAILED' } });
    emit('agent2:deploy_failed', { deploymentId }, storeId);
    throw new Error('Deployment failed');
  }

  // Step 5: Finalize
  await prisma.store.update({
    where: { id: storeId },
    data: { status: 'ACTIVE', activatedAt: new Date() },
  });

  emit('agent2:store_live', { url: serviceUrl, storeId }, storeId);
  return { storeId, serviceId, serviceUrl, deploymentId };
}

async function monitorDeployment(deploymentId, storeId) {
  const TERMINAL = ['healthy', 'failed', 'cancelled', 'rolled_back'];
  const MAX_POLLS = 20; // 20 * 30s = 10 min max
  const POLL_INTERVAL = config.isMock ? 100 : 30000; // 100ms in mock, 30s real

  for (let i = 0; i < MAX_POLLS; i++) {
    const data = await callBuild('GET', `/deployments/${deploymentId}`);
    const status = data.status || 'unknown';

    emit('agent2:deploy_status', { status, poll: i + 1 }, storeId);

    if (TERMINAL.includes(status)) {
      return status;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  return 'timeout';
}

module.exports = { runBuilder };
