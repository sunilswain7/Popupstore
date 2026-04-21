const isMock = process.env.MOCK_LOCUS_API === 'true';

module.exports = {
  isMock,
  port: parseInt(process.env.PORT || '8080', 10),
  databaseUrl: process.env.DATABASE_URL || '',

  // Locus Pay
  locusPayApiKey: process.env.LOCUS_API_KEY || '',
  locusPayApiBase: process.env.LOCUS_PAY_API_BASE || 'https://beta-api.paywithlocus.com/api',

  // Locus Build
  locusBuildApiBase: process.env.LOCUS_BUILD_API_BASE || 'https://beta-api.buildwithlocus.com/v1',
  locusBuildToken: process.env.LOCUS_BUILD_TOKEN || '',

  // Shared project for storefronts
  storefrontProjectId: process.env.STOREFRONT_PROJECT_ID || '',
  storefrontEnvId: process.env.STOREFRONT_ENV_ID || '',
  storefrontRepo: process.env.STOREFRONT_REPO || 'AshutoshVatsg/agent_buildwithlocus_agent2',
  storefrontRepoBranch: process.env.STOREFRONT_REPO_BRANCH || 'main',

  // Dashboard URL (self-reference for webhooks & inventory API)
  dashboardUrl: process.env.LOCUS_SERVICE_URL || process.env.DASHBOARD_URL || 'http://localhost:8080',

  // Email (Resend)
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'PopupStore <noreply@popupstore.dev>',

  // Webhook secret for HMAC verification
  webhookSecret: process.env.WEBHOOK_SECRET || 'dev-secret',
};
