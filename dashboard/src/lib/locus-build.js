const config = require('./config');

let cachedToken = null;
let tokenExpiresAt = 0;

async function getBuildToken() {
  if (config.isMock) return 'mock-build-token';

  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  // Exchange API key for JWT
  const res = await fetch(`${config.locusBuildApiBase}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: config.locusPayApiKey }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Build auth failed: ${JSON.stringify(data)}`);

  cachedToken = data.token;
  // Refresh 1 day before expiry (tokens last 30 days)
  tokenExpiresAt = Date.now() + 29 * 24 * 60 * 60 * 1000;
  return cachedToken;
}

async function callBuild(method, path, body) {
  if (config.isMock) {
    console.log(`[MOCK] Locus Build ${method} ${path}`, body || '');
    return mockBuildResponse(method, path, body);
  }

  const token = await getBuildToken();
  const url = `${config.locusBuildApiBase}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (res.status === 204) return {};
  const data = await res.json();
  if (res.status >= 400) {
    throw new Error(`Build API error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

let mockServiceCounter = 0;

function mockBuildResponse(method, path, body) {
  if (path === '/billing/balance') {
    return { creditBalance: 0.92, totalServices: 0, status: 'active', warnings: [] };
  }
  if (path === '/services' && method === 'POST') {
    mockServiceCounter++;
    const id = `svc_mock_${mockServiceCounter}`;
    return {
      id,
      name: body?.name || 'mock-service',
      url: `https://svc-mock-${mockServiceCounter}.buildwithlocus.com`,
    };
  }
  if (path.startsWith('/variables/service/')) {
    return { variables: body?.variables || {} };
  }
  if (path === '/deployments' && method === 'POST') {
    return {
      id: `deploy_mock_${Date.now()}`,
      serviceId: body?.serviceId,
      status: 'queued',
      version: 1,
    };
  }
  if (path.startsWith('/deployments/')) {
    return { id: path.split('/')[2], status: 'healthy', durationMs: 5000 };
  }
  if (path.startsWith('/services/') && method === 'DELETE') {
    return {};
  }
  return {};
}

module.exports = { callBuild, getBuildToken };
