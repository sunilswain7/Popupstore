const { callLocusPay } = require('../lib/locus-pay');
const config = require('../lib/config');
const { emit } = require('../lib/sse');

const SPEC_SCHEMA = {
  productName: 'string',
  price: 'number',
  inventory: 'number',
  endDate: 'string',
  postDropAction: 'string',
  generateImage: 'boolean',
  imagePrompt: 'string',
};

const VALID_POST_DROP_ACTIONS = ['WAITLIST', 'SOLD_OUT_PAGE', 'TEARDOWN'];

async function runSpecGuard(rawInput, storeId) {
  emit('agent1:start', { message: 'Parsing your drop description...' }, storeId);

  let spec;
  try {
    spec = await extractSpec(rawInput);
  } catch (err) {
    const result = { status: 'BLOCKED', reason: `LLM extraction failed: ${err.message}`, spec: null };
    emit('agent1:blocked', result, storeId);
    return result;
  }

  // Validate
  const error = validateSpec(spec);
  if (error) {
    const result = { status: 'BLOCKED', reason: error, spec };
    emit('agent1:blocked', result, storeId);
    return result;
  }

  // Defaults
  if (!spec.postDropAction) spec.postDropAction = 'SOLD_OUT_PAGE';
  if (spec.generateImage === undefined) spec.generateImage = false;

  const result = { status: 'APPROVED', reason: null, spec };
  emit('agent1:complete', result, storeId);
  return result;
}

async function extractSpec(rawInput) {
  const now = new Date().toISOString();
  const systemPrompt = `You are a structured data extractor for a product drop platform.

Current server time: ${now}

Extract ONLY explicitly stated values from the user's input. Do NOT infer missing values.

For endDate extraction:
- Relative durations ("5 hours", "2 days"): add to current time
- Day references without time ("Friday"): use 23:59:59 of that day
- Day references with time ("Friday at 8pm"): use specified time
- If referenced day already passed this week, use NEXT week
- Always output ISO 8601 with timezone (UTC if unspecified)
- If no end time can be determined: set endDate to null

Return a JSON object with these fields:
- productName (string or null)
- price (number or null)
- inventory (integer or null)
- endDate (ISO 8601 string or null)
- postDropAction ("WAITLIST" | "SOLD_OUT_PAGE" | "TEARDOWN" or null)
- generateImage (boolean, default false)
- imagePrompt (string or null)

ONLY return valid JSON. No markdown, no explanation.`;

  if (config.isMock) {
    return mockExtract(rawInput);
  }

  // Try haiku first, fallback to sonnet
  const models = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6-20250514'];
  let lastError;

  for (const model of models) {
    try {
      const response = await callLocusPay('POST', '/wrapped/anthropic/chat', {
        model,
        max_tokens: 500,
        messages: [
          { role: 'user', content: rawInput },
        ],
        system: systemPrompt,
      });

      const text = response.data?.content?.[0]?.text || '';
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      lastError = err;
      console.log(`Model ${model} failed, trying next...`, err.message);
    }
  }

  throw lastError || new Error('All models failed');
}

function mockExtract(rawInput) {
  const lower = rawInput.toLowerCase();

  // Simple heuristic parser for mock mode
  let productName = null;
  let price = null;
  let inventory = null;
  let endDate = null;
  let postDropAction = null;

  // Extract price: "$25", "at $25", "$25.00"
  const priceMatch = lower.match(/\$(\d+(?:\.\d{1,2})?)/);
  if (priceMatch) price = parseFloat(priceMatch[1]);

  // Extract inventory: "20 signed prints", "50 units", "100 shirts"
  const invMatch = rawInput.match(/(\d+)\s+(?:signed\s+)?(?:prints?|units?|shirts?|copies|items?|pieces?|stickers?|hoodies?|posters?|tickets?)/i);
  if (invMatch) inventory = parseInt(invMatch[1], 10);

  // Extract end date: "ends Sunday", "5 hour drop", "drop ends Friday"
  const now = new Date();
  const dayMatch = lower.match(/(?:ends?|until)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  const durationMatch = lower.match(/(\d+)\s*(hour|day|minute|min|hr)s?\s*(?:drop|sale)?/);

  if (dayMatch) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayMatch[1]);
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const target = new Date(now);
    target.setDate(target.getDate() + daysUntil);
    target.setHours(23, 59, 59, 0);
    endDate = target.toISOString();
  } else if (durationMatch) {
    const val = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    const target = new Date(now);
    if (unit.startsWith('hour') || unit.startsWith('hr')) target.setHours(target.getHours() + val);
    else if (unit.startsWith('day')) target.setDate(target.getDate() + val);
    else if (unit.startsWith('min')) target.setMinutes(target.getMinutes() + val);
    endDate = target.toISOString();
  }

  // Extract product name: heuristic — take the main noun phrase
  // Look for "selling X <product>" pattern
  const nameMatch = rawInput.match(/(?:selling\s+\d+\s+)(.*?)(?:\s+at\s+|\s+for\s+|\s*,)/i);
  if (nameMatch) {
    productName = nameMatch[1].trim();
  } else {
    // Fallback: remove known patterns, use what's left
    let cleaned = rawInput
      .replace(/\$\d+(?:\.\d{1,2})?/g, '')
      .replace(/\d+\s*(hour|day|minute|min|hr)s?\s*(drop|sale)?/gi, '')
      .replace(/(selling|drop|ends?|until|at|for)\s*/gi, '')
      .replace(/\d+/g, '')
      .replace(/[,\.]/g, '')
      .trim();
    if (cleaned.length > 2) productName = cleaned;
  }

  // postDropAction from text
  if (lower.includes('waitlist')) postDropAction = 'WAITLIST';
  else if (lower.includes('teardown') || lower.includes('tear down') || lower.includes('delete')) postDropAction = 'TEARDOWN';

  return {
    productName,
    price,
    inventory,
    endDate,
    postDropAction,
    generateImage: lower.includes('generate image') || lower.includes('create image'),
    imagePrompt: null,
  };
}

function validateSpec(spec) {
  if (!spec.productName || spec.productName.trim().length === 0) {
    return 'Missing product name';
  }
  if (spec.productName.length > 100) {
    return 'Product name must be under 100 characters';
  }
  if (spec.price === null || spec.price === undefined || spec.price <= 0) {
    return 'Invalid price';
  }
  if (spec.inventory === null || spec.inventory === undefined || spec.inventory <= 0 || !Number.isInteger(spec.inventory)) {
    return 'Invalid inventory';
  }
  if (spec.inventory > 10000) {
    return 'Inventory cannot exceed 10,000';
  }
  if (!spec.endDate) {
    return 'Missing end date';
  }
  const endDateObj = new Date(spec.endDate);
  if (isNaN(endDateObj.getTime())) {
    return 'Invalid end date format';
  }
  const now = Date.now();
  if (endDateObj.getTime() <= now) {
    return 'End date must be in the future';
  }
  if (endDateObj.getTime() - now < 5 * 60 * 1000) {
    return 'Drop must be at least 5 minutes long';
  }
  if (endDateObj.getTime() - now > 365 * 24 * 60 * 60 * 1000) {
    return 'Drop cannot exceed 1 year';
  }
  if (spec.postDropAction && !VALID_POST_DROP_ACTIONS.includes(spec.postDropAction)) {
    return `Invalid postDropAction. Must be one of: ${VALID_POST_DROP_ACTIONS.join(', ')}`;
  }
  return null;
}

module.exports = { runSpecGuard };
