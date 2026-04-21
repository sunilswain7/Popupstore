const { callLocusPay } = require('../lib/locus-pay');
const config = require('../lib/config');
const { emit } = require('../lib/sse');

const VALID_POST_DROP_ACTIONS = ['WAITLIST', 'SOLD_OUT_PAGE', 'TEARDOWN'];

// Parse-only: returns spec + field-level errors for user review
async function parseInput(rawInput) {
  let spec;
  try {
    spec = await extractSpec(rawInput);
  } catch (err) {
    return { spec: null, errors: [{ field: '_general', message: `LLM extraction failed: ${err.message}` }] };
  }

  // Defaults
  if (!spec.postDropAction) spec.postDropAction = 'SOLD_OUT_PAGE';
  if (!spec.items) spec.items = [];

  const errors = validateSpecFields(spec);
  return { spec, errors };
}

// Validate a confirmed spec (final gate before builder)
function validateConfirmedSpec(spec) {
  const errors = validateSpecFields(spec);
  if (errors.length > 0) {
    return { status: 'BLOCKED', reason: errors.map(e => e.message).join('; '), spec, errors };
  }
  return { status: 'APPROVED', reason: null, spec, errors: [] };
}

// Legacy: full run (parse + validate + emit SSE)
async function runSpecGuard(rawInput, storeId) {
  emit('agent1:start', { message: 'Parsing your drop description...' }, storeId);

  const { spec, errors } = await parseInput(rawInput);
  if (!spec || errors.length > 0) {
    const reason = errors.map(e => e.message).join('; ');
    const result = { status: 'BLOCKED', reason, spec, errors };
    emit('agent1:blocked', result, storeId);
    return result;
  }

  const result = { status: 'APPROVED', reason: null, spec };
  emit('agent1:complete', result, storeId);
  return result;
}

async function extractSpec(rawInput) {
  const now = new Date().toISOString();
  const systemPrompt = `You are a structured data extractor for a product drop platform.
A "drop" is a time-limited sale that can contain ONE OR MULTIPLE items.

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
- dropName (string): a short name for this drop, derived from the products or context. e.g. "Art Print Drop", "Sticker & Hoodie Sale"
- items (array of objects, each with):
  - productName (string or null)
  - price (number or null)
  - inventory (integer or null)
  - generateImage (boolean, default false)
  - imagePrompt (string or null)
- endDate (ISO 8601 string or null) — shared across all items
- postDropAction ("WAITLIST" | "SOLD_OUT_PAGE" | "TEARDOWN" or null) — shared across all items

If the user describes a single product, return an items array with one element.
If the user describes multiple products (e.g. "20 prints at $25 and 50 stickers at $5"), return multiple items.

ONLY return valid JSON. No markdown, no explanation.`;

  if (config.isMock) {
    return mockExtract(rawInput);
  }

  const models = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6-20250514'];
  let lastError;

  for (const model of models) {
    try {
      const response = await callLocusPay('POST', '/wrapped/anthropic/chat', {
        model,
        max_tokens: 800,
        messages: [{ role: 'user', content: rawInput }],
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
  const now = new Date();

  // Parse end date
  let endDate = null;
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

  // Parse multiple items: split on "and", ",", "&"
  // Pattern: "<quantity> <product> at/for $<price>"
  const items = [];
  const segments = rawInput.split(/\s*(?:,\s*and\s+|,\s+|\s+and\s+|&)\s*/i);

  for (const seg of segments) {
    const itemMatch = seg.match(/(\d+)\s+(.*?)\s+(?:at|for)\s+\$(\d+(?:\.\d{1,2})?)/i);
    if (itemMatch) {
      items.push({
        productName: itemMatch[2].trim(),
        price: parseFloat(itemMatch[3]),
        inventory: parseInt(itemMatch[1], 10),
        generateImage: false,
        imagePrompt: null,
      });
    }
  }

  // Fallback: try single-item pattern on the whole input
  if (items.length === 0) {
    const priceMatch = lower.match(/\$(\d+(?:\.\d{1,2})?)/);
    const invMatch = rawInput.match(/(\d+)\s+(?:signed\s+)?(?:\w+)/i);
    let productName = rawInput.replace(/\$\d+(?:\.\d+)?/g, '').replace(/\d+\s*(hour|day|minute)s?\s*(drop|sale)?/gi, '').replace(/(selling|drop|ends?|until|at|for)\s*/gi, '').replace(/\d+/g, '').replace(/[,\.]/g, '').trim();

    items.push({
      productName: productName || 'Product',
      price: priceMatch ? parseFloat(priceMatch[1]) : null,
      inventory: invMatch ? parseInt(invMatch[1], 10) : null,
      generateImage: false,
      imagePrompt: null,
    });
  }

  // Derive drop name
  const dropName = items.length === 1
    ? `${items[0].productName} Drop`
    : items.map(i => i.productName).join(' & ') + ' Drop';

  // postDropAction from text
  let postDropAction = null;
  if (lower.includes('waitlist')) postDropAction = 'WAITLIST';
  else if (lower.includes('teardown') || lower.includes('delete')) postDropAction = 'TEARDOWN';

  return { dropName, items, endDate, postDropAction };
}

// Returns array of field-level errors (empty = valid)
function validateSpecFields(spec) {
  const errors = [];

  if (!spec.items || !Array.isArray(spec.items) || spec.items.length === 0) {
    errors.push({ field: 'items', message: 'Add at least one item to your drop' });
    return errors; // can't validate items if none exist
  }

  for (let i = 0; i < spec.items.length; i++) {
    const item = spec.items[i];
    const prefix = spec.items.length > 1 ? `Item ${i + 1}: ` : '';

    if (!item.productName || item.productName.trim().length === 0) {
      errors.push({ field: `items[${i}].productName`, message: `${prefix}Product name is required` });
    } else if (item.productName.length > 100) {
      errors.push({ field: `items[${i}].productName`, message: `${prefix}Product name must be under 100 characters` });
    }
    if (item.price === null || item.price === undefined || item.price <= 0) {
      errors.push({ field: `items[${i}].price`, message: `${prefix}Price is required (must be > 0)` });
    }
    if (item.inventory === null || item.inventory === undefined || item.inventory <= 0 || !Number.isInteger(item.inventory)) {
      errors.push({ field: `items[${i}].inventory`, message: `${prefix}Inventory count is required (whole number > 0)` });
    } else if (item.inventory > 10000) {
      errors.push({ field: `items[${i}].inventory`, message: `${prefix}Inventory cannot exceed 10,000` });
    }
  }

  if (!spec.dropName || spec.dropName.trim().length === 0) {
    // Auto-derive instead of erroring
    if (spec.items.length > 0 && spec.items[0].productName) {
      spec.dropName = spec.items.map(i => i.productName || 'Product').join(' & ') + ' Drop';
    } else {
      errors.push({ field: 'dropName', message: 'Drop name is required' });
    }
  }

  if (!spec.endDate) {
    errors.push({ field: 'endDate', message: 'End date/time is required (e.g. "2 hours", "Sunday")' });
  } else {
    const endDateObj = new Date(spec.endDate);
    if (isNaN(endDateObj.getTime())) {
      errors.push({ field: 'endDate', message: 'Invalid date format' });
    } else if (endDateObj.getTime() <= Date.now()) {
      errors.push({ field: 'endDate', message: 'End date must be in the future' });
    } else if (endDateObj.getTime() - Date.now() < 5 * 60 * 1000) {
      errors.push({ field: 'endDate', message: 'Drop must be at least 5 minutes long' });
    } else if (endDateObj.getTime() - Date.now() > 365 * 24 * 60 * 60 * 1000) {
      errors.push({ field: 'endDate', message: 'Drop cannot exceed 1 year' });
    }
  }

  if (spec.postDropAction && !VALID_POST_DROP_ACTIONS.includes(spec.postDropAction)) {
    errors.push({ field: 'postDropAction', message: `Must be one of: ${VALID_POST_DROP_ACTIONS.join(', ')}` });
  }

  return errors;
}

module.exports = { runSpecGuard, parseInput, validateConfirmedSpec };
