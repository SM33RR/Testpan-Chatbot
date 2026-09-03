/**
 * Normalize conversational wording before intent and knowledge-base matching.
 * This is intentionally deterministic: portal routing must still work when the
 * AI provider is unavailable.
 */
const REPLACEMENTS = [
  [/\breg+ist?e?r?\b|\bregster\b|\bregistrtion\b|\bregistation\b/g, 'register'],
  [/\b(?:bok|boook|boking|bookin)\b/g, 'book'],
  [/\btest\s*(?:cntr|centr|centre|center)\b/g, 'test center'],
  [/\bexam\s*(?:cntr|centr|centre|center|hall|venue)\b/g, 'exam center'],
  [/\b(?:pariksha|pariksha)\s*(?:kendra|kendr|center|centre)\b/g, 'exam center'],
  [/\b(?:kendra|kendr)\b/g, 'center'],
  [/\b(?:jodna|jod|jurna|judna)\b/g, 'register'],
  [/\b(?:dakhila|naamankan)\b/g, 'register'],
  [/(?:परीक्षा)\s*(?:केंद्र|केन्द्र)/g, 'exam center'],
  [/(?:पंजीकरण|रजिस्टर)/g, 'register'],
  [/(?:बुकिंग|बुक)/g, 'book']
];

export function normalizeUserQuery(query = '') {
  let normalized = String(query)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[-_/.,!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Resolve the two business-critical portal intents from normalized wording.
 */
export function getPortalIntent(query) {
  const normalized = normalizeUserQuery(query);
  const hasCenter = /\b(?:test|exam)?\s*center\b|\bvenue\b/.test(normalized);
  const wantsRegistration = /\b(?:register|registration|partner|onboard|setup|set up|start|join|enroll)\b/.test(normalized);
  const wantsBooking = /\b(?:book|booking|conduct|host|hire|source|reserve)\b/.test(normalized);

  if (wantsRegistration && hasCenter) {
    return 'centre-registration';
  }

  if (wantsBooking && (hasCenter || /\bexam\b/.test(normalized))) {
    return 'client-booking';
  }

  return null;
}
