const config = require('./config');

async function callLocusPay(method, path, body) {
  if (config.isMock) {
    console.log(`[MOCK] Locus Pay ${method} ${path}`, body || '');
    return mockPayResponse(path, body);
  }

  const url = `${config.locusPayApiBase}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${config.locusPayApiKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();
  if (!data.success && res.status >= 400) {
    throw new Error(`Locus Pay error: ${data.message || data.error || res.status}`);
  }
  return data;
}

function mockPayResponse(path, body) {
  if (path.includes('/wrapped/anthropic/chat')) {
    // Mock LLM response — Agent 1 will parse this
    return {
      success: true,
      data: {
        content: [{ type: 'text', text: JSON.stringify({ mock: true }) }],
      },
    };
  }
  if (path.includes('/checkout/sessions')) {
    const mockId = `cs_mock_${Date.now()}`;
    return {
      success: true,
      data: {
        id: mockId,
        checkoutUrl: `https://checkout.paywithlocus.com/${mockId}`,
      },
    };
  }
  if (path.includes('/wrapped/fal/generate')) {
    return {
      success: true,
      data: { images: [{ url: 'https://placehold.co/600x400?text=MockImage' }] },
    };
  }
  if (path.includes('/pay/balance')) {
    return { success: true, data: { usdc_balance: '10.00', promo_credit_balance: '5.00' } };
  }
  return { success: true, data: {} };
}

module.exports = { callLocusPay };
