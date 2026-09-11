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
 *
 * Two bugs fixed here:
 * 1. hasCenter's old regex (`\bcenter\b`) required a word boundary
 *    immediately after "center" — which fails to match "centers"/"centres"
 *    (plural), since there's no boundary between "r" and a following "s".
 *    Now matches singular and plural, and the "centre" spelling too.
 * 2. The client-booking check used `hasCenter || /\bexam\b/.test(...)` —
 *    that OR meant ANY message with a booking-ish verb ("book", "conduct",
 *    "host"...) AND the word "exam" anywhere in it got redirected to the
 *    generic client portal link, even complex questions like "We want to
 *    conduct a large exam through TESTPAN, how do we get started?" or
 *    "Can I check which dates and seats are free before booking a test
 *    center?" — both were confirmed hijacked into the generic redirect
 *    instead of getting a real, specific answer. Now requires hasCenter
 *    explicitly for both intents, so only genuine center/venue booking or
 *    registration requests short-circuit here; more complex exam-related
 *    questions fall through to AI/RAG where they can get a real answer.
 */
export function getPortalIntent(query) {
  const normalized = normalizeUserQuery(query);
  const hasCenter = /\b(?:test|exam)?\s*cent(?:er|re)s?\b|\bvenues?\b/.test(normalized);
  const wantsRegistration = /\b(?:register|registration|partner|onboard|setup|set up|start|join|enroll)\b/.test(normalized);
  const wantsBooking = /\b(?:book|booking|conduct|host|hire|source|reserve)\b/.test(normalized);

  if (wantsRegistration && hasCenter) {
    return 'centre-registration';
  }

  if (wantsBooking && hasCenter) {
    return 'client-booking';
  }

  return null;
}