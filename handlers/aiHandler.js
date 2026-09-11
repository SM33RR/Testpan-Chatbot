import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getSiteProfile, normalizeSite } from '../config/siteConfig.js';
import { getPortalIntent, normalizeUserQuery } from './intentMatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// gemini-flash-latest auto-tracks Google's current Flash model. On 2 Sep 2026
// that alias was swapped to Gemini 3.8 Flash, which dropped thinkingLevel
// 'minimal' (only low/medium/high). Pin the model via GEMINI_MODEL if a
// future alias swap is unacceptable for this bot.
const GEMINI_FLASH_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const PREFERRED_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'low';

// When the primary model returns 503 "high demand" (a Google-side capacity
// issue — happens on paid accounts too, it's not a quota problem), retrying
// the SAME model just queues behind the same overload. Retrying against a
// different, usually-less-congested model gives the retry an actual chance
// to succeed quickly instead of hitting the same wall twice. gemini-3.6-flash
// is Google's own recommended fallback for older Flash aliases as of Sep
// 2026 (gemini-2.5-flash was retired for new users). Override via
// GEMINI_FALLBACK_MODEL if Google moves the goalposts again — check
// https://ai.google.dev/gemini-api/docs/models for the current lineup if
// this one ever starts 404ing too.
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';

// Hard ceiling per attempt. Without this, a 503/high-demand situation can
// leave a user (or a live demo) staring at a spinner for 60-100+ seconds
// before anything happens, even though the request eventually succeeds.
// Capping each attempt means the total worst case (primary + fallback) is
// bounded and predictable instead of open-ended.
const GEMINI_ATTEMPT_TIMEOUT_MS =
  Number(process.env.GEMINI_TIMEOUT_MS) || 15000;
  
let geminiModel = null;
let geminiFallbackModel = null;
let geminiThinkingDisabled = false;

// Load and parse knowledge base
const knowledgeBasePath = path.join(__dirname, '..', 'knowledgeBase.json');
let contextText = '';
let searchIndex = new Map();
let knowledgeBasePages = [];

/**
 * Convert knowledge base pages to readable context text
 */
function formatContextFromPages(pages) {
  return pages
    .map(page => `Title: ${page.title}\nURL: ${page.url}\nContent:\n${page.content}`)
    .join('\n\n---\n\n');
}

/**
 * Builds an in-memory inverted index for fast keyword-based document retrieval.
 * This runs once at startup to avoid expensive searches on every query.
 * @param {Array<Object>} pages - The array of knowledge base page objects.
 */
function buildSearchIndex(pages) {
  console.log('Building in-memory search index...');
  const index = new Map();
  pages.forEach((page, pageIndex) => {
    // Create a text corpus for the page and get unique words (3+ chars).
    const content = `${page.title} ${page.content}`.toLowerCase();
    const words = new Set(content.match(/\b\w{3,}\b/g) || []);
    words.forEach(word => {
      if (!index.has(word)) index.set(word, []);
      index.get(word).push(pageIndex);
    });
  });
  console.log(`   ✓ Search index built with ${index.size} unique terms.`);
  return index;
}

/**
 * Shared Hinglish marker word list. Previously this lived only inside
 * shouldUseAI(), so nothing else in this file (e.g. getFallbackResponse)
 * could detect the user's language. That's a root cause of the
 * English-query-gets-Hinglish-response bug: hardcoded fallback strings
 * had no way to know what language they were replying in.
 */
const HINGLISH_MARKERS = [
  'kya', 'kaise', 'kab', 'kahan', 'batao', 'kaun', 'kyun', 'kya hai', 'kaise ho',
  'kya kar', 'kya hota', 'kya tha', 'kya ek', 'kya aap', 'kya milta',
  'bata', 'bataiye', 'samjha', 'samjhao', 'samjhiye',
  'haan', 'nahi', 'hai', 'hain', 'ho', 'karo', 'kar', 'karega', 'karoge',
  'dusara', 'doosra', 'aur', 'ya', 'yaa', 'malum', 'jaaniye', 'suno'
];

/**
 * Returns true only if the query shows a genuine Hinglish marker.
 * Used by BOTH shouldUseAI (routing) and getFallbackResponse/getFastPathResponse
 * (so every hardcoded string we return also matches the input language).
 */
function isHinglishQuery(query) {
  const lowerQuery = normalizeUserQuery(query);
  return HINGLISH_MARKERS.some(word => {
    if (word.includes(' ')) return lowerQuery.includes(word);
    // Word boundaries only — 'ho' must not match inside 'who', 'hai' inside
    // 'thailand', etc. That was leaking Hinglish replies onto English questions.
    return new RegExp(`\\b${word}\\b`, 'i').test(lowerQuery);
  });
}

/**
 * Synonym mapping for query expansion
 * Maps user query terms to related keywords for better RAG matching
 */
const SYNONYM_MAP = {
  'leadership': ['rajesh setia', 'ceo', 'management', 'founder', 'leader', 'leadership', 'director', 'team', 'owner', 'head'],
  'leader': ['rajesh setia', 'ceo', 'management', 'founder', 'leader', 'leadership', 'director', 'team', 'owner', 'head'],
  'ceo': ['rajesh setia', 'ceo', 'management', 'founder', 'leader', 'leadership', 'director', 'team', 'owner', 'head'],
  'founder': ['rajesh setia', 'founder', 'founded', 'founder', 'ceo', 'leadership', 'establishment', '2016'],
  'services': ['cbt', 'test center', 'manpowerx', 'manpower', 'infrastructure', 'exam center', 'bookmytestcenter', 'booking'],
  'solutions': ['cbt', 'test center', 'manpowerx', 'manpower', 'infrastructure', 'exam center', 'bookmytestcenter'],
  'what do you do': ['services', 'solutions', 'offerings', 'work', 'provide', 'cbt', 'test center', 'manpowerx', 'infrastructure'],
  'manpower': ['manpowerx', 'staffing', 'recruitment', 'workforce', 'invigilator', 'personnel', 'staff'],
  'staffing': ['manpowerx', 'staffing', 'recruitment', 'workforce', 'personnel', 'staff', 'invigilator'],
  'invigilator': ['manpowerx', 'staffing', 'recruitment', 'workforce', 'invigilator', 'personnel', 'exam proctor'],
  'bmtc': ['bookmytestcenter', 'bmtc', 'exam center booking', 'slot', 'venue', 'partner portal'],
  'book my test center': ['bookmytestcenter', 'bmtc', 'exam center booking', 'slot', 'venue', 'partner portal'],
  'booking portal': ['bookmytestcenter', 'bmtc', 'exam center booking', 'slot', 'venue', 'partner portal'],
  'register': ['registration', 'onboard', 'partner', 'test center', 'exam center'],
  'book': ['booking', 'hire', 'host', 'exam center', 'test center', 'venue'],
  'exam center': ['test center', 'exam hall', 'venue', 'bookmytestcenter', 'bmtc'],
  'manpowerx': ['manpowerx', 'staffing', 'invigilator', 'workforce', 'recruitment'],
  'manpower x': ['manpowerx', 'staffing', 'invigilator', 'workforce', 'recruitment'],
  'mpx': ['manpowerx', 'staffing', 'invigilator', 'workforce', 'recruitment']
};

/**
 * Expand query with synonyms to improve matching
 */
function expandQueryWithSynonyms(query) {
  const lowerQuery = normalizeUserQuery(query);
  const expandedTerms = new Set();
  
  // Add original words
  lowerQuery.split(/\s+/).forEach(word => expandedTerms.add(word));
  
  // Expand with synonyms
  Object.entries(SYNONYM_MAP).forEach(([key, synonyms]) => {
    if (lowerQuery.includes(key)) {
      synonyms.forEach(syn => expandedTerms.add(syn));
    }
  });
  
  return Array.from(expandedTerms);
}

/**
 * ---------------------------------------------------------------------
 * CHUNKING
 * ---------------------------------------------------------------------
 * The KB pages are raw scraped website content — some are 30,000+
 * characters (nav menus, footers, full page markup) with the actual
 * answer buried thousands of characters in. Both the old keyword search
 * and the semantic search below used to call page.content.slice(0, 1500)
 * when building context — which ALWAYS takes the first 1500 characters
 * (nav/header junk) and throws away the rest of the page, including the
 * actual answer. Confirmed concretely: on the homepage and BMTC/ManpowerX
 * pages, the sentences answering "how many cities/centers", "is there a
 * mobile app", and "how does booking confirmation work" all sit between
 * character 4,500 and 10,400 — well past that cutoff.
 *
 * Fix: split every page into overlapping ~900-character chunks and treat
 * each chunk as its own retrievable unit (same url/title/domain, so
 * citations still point at the right page). This means a 30,000-char
 * page becomes ~35 searchable chunks instead of one chunk that's always
 * just the header.
 */
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;

// Pages that are pure site-navigation noise (sitemaps, generic WordPress
// theme demo categories unrelated to the actual business) and shouldn't be
// searched at all — they only dilute scoring. This list is a starting
// point, not exhaustive — the client should review knowledgeBase.json and
// prune/replace these with real FAQ content rather than leaving them in.
const JUNK_URL_PATTERNS = [
  '/sitemap.xml', 'sitemap.xml', '/category/uncategorized', '/category/estate-planning',
  '/category/accumulation', '/category/digital/', '/category/business-management',
  '/category/business-planning', '/entrepreneurship/'
];

function isJunkPage(page) {
  return JUNK_URL_PATTERNS.some(pattern => (page.url || '').includes(pattern));
}

function chunkText(content, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (content.length <= size) return [content];
  const chunks = [];
  let start = 0;
  while (start < content.length) {
    const end = Math.min(start + size, content.length);
    chunks.push(content.slice(start, end));
    if (end === content.length) break;
    start = end - overlap;
  }
  return chunks;
}

/**
 * Turns the raw KB pages array into a flat array of searchable chunks.
 * This is what gets indexed/embedded/searched from here on — NOT the raw
 * pages array. Junk pages (see isJunkPage) are skipped entirely.
 */
function buildKnowledgeChunks(pages) {
  const chunks = [];
  pages.forEach(page => {
    if (isJunkPage(page)) return;
    chunkText(page.content || '').forEach((chunkContent, chunkIndex) => {
      chunks.push({ ...page, content: chunkContent, chunkIndex });
    });
  });
  return chunks;
}

let knowledgeChunks = [];

/**
 * ---------------------------------------------------------------------
 * SEMANTIC SEARCH (embeddings)
 * ---------------------------------------------------------------------
 * The previous "search index" above is pure keyword/inverted-index
 * matching — it can only find a page if the user's exact words (or a
 * manually maintained synonym) appear in that page's text. That's why
 * paraphrased or long-tail questions ("How many test centers and
 * cities do you cover across India?") were scoring too low and
 * tripping the fallback even when relevant KB content existed.
 *
 * This section adds real semantic retrieval using Gemini's embedding
 * model: every KB page gets embedded once (cached to disk), the user's
 * query gets embedded per-request, and we rank by cosine similarity.
 * This is what should be doing the primary retrieval. The keyword index
 * above is kept ONLY as a fallback for the brief window during server
 * startup before embeddings finish building, or if embeddings fail for
 * some reason (e.g. quota).
 */
// 'text-embedding-004' was Google's stable embedding model when this was
// first written, but Google shut it down on January 14, 2025 — it now
// 404s unconditionally, which is the exact error this project hit. The
// replacement is 'gemini-embedding-001'. Its default output is 3072
// dimensions; we request 768 instead to keep the embeddings cache and
// in-memory vectors small (768 keeps ~99.7% of the quality per Google's
// own benchmarks, per Matryoshka Representation Learning). Note: only the
// full 3072-dim output is pre-normalized by Google's API — but that
// doesn't matter here, because cosineSimilarity() below already divides
// by both vectors' magnitudes, so it computes true cosine similarity
// regardless of whether the input vectors were pre-normalized.
const EMBEDDING_MODEL_NAME = 'gemini-embedding-001';
const EMBEDDING_OUTPUT_DIMENSIONALITY = 768;
const embeddingsCachePath = path.join(__dirname, '..', 'embeddingsCache.json');
let embeddingModel = null;
let pageEmbeddings = [];       // parallel array to knowledgeBasePages
let embeddingsReady = false;   // becomes true once buildPageEmbeddings() finishes

function getEmbeddingModel() {
  if (embeddingModel) return embeddingModel;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // outputDimensionality is passed at model-creation time in the (now
    // deprecated) @google/generative-ai SDK this project uses — it isn't a
    // per-call option here the way it is in the newer @google/genai SDK.
    embeddingModel = genAI.getGenerativeModel({
      model: EMBEDDING_MODEL_NAME,
      outputDimensionality: EMBEDDING_OUTPUT_DIMENSIONALITY
    });
    return embeddingModel;
  } catch (error) {
    console.error('Failed to initialize embedding model:', error);
    return null;
  }
}

async function embedText(text) {
  const model = getEmbeddingModel();
  if (!model) return null;
  try {
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('Embedding request failed:', error.message);
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Builds (or loads from disk cache) an embedding vector for every KB chunk.
 * Runs once at startup, in the background, so it doesn't block server boot.
 * Cache is keyed by an md5 hash of the chunk content, so editing
 * knowledgeBase.json only re-embeds the chunks that actually changed.
 */
async function buildPageEmbeddings(chunks) {
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(embeddingsCachePath, 'utf8'));
  } catch {
    // no cache yet — fine, we'll create it
  }

  const embeddings = [];
  let cacheDirty = false;

  for (const chunk of chunks) {
    // Cache key includes the model name + dimensionality, not just the
    // content — so if the embedding model is ever swapped again (as just
    // happened with text-embedding-004's shutdown), old cached vectors from
    // a different/incompatible model are never silently reused.
    const key = crypto.createHash('md5').update(`${EMBEDDING_MODEL_NAME}\n${EMBEDDING_OUTPUT_DIMENSIONALITY}\n${chunk.title}\n${chunk.chunkIndex}\n${chunk.content}`).digest('hex');
    if (cache[key]) {
      embeddings.push(cache[key]);
      continue;
    }
    const vec = await embedText(`${chunk.title}\n${chunk.content}`);
    embeddings.push(vec);
    if (vec) {
      cache[key] = vec;
      cacheDirty = true;
    }
  }

  if (cacheDirty) {
    try {
      fs.writeFileSync(embeddingsCachePath, JSON.stringify(cache));
    } catch (error) {
      console.error('Failed to write embeddings cache:', error.message);
    }
  }

  return embeddings;
}

/**
 * Semantic retrieval over chunks. Returns null (not an empty result) if
 * embeddings aren't ready or the query couldn't be embedded, so the caller
 * knows to fall back to keyword search rather than treating "no semantic
 * match" as "nothing relevant exists".
 */
async function searchRelevantContextSemantic(query, chunks, maxSnippets, currentSite) {
  if (!embeddingsReady || pageEmbeddings.length !== chunks.length) return null;

  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) return null;

  const siteProfile = getSiteProfile(currentSite);
  const isBmtcQuery = /\bbmtc\b|book\s*my\s*test\s*cent(?:er|re)|booking\s+portal|test\s*cent(?:er|re)\s+booking/i.test(query);

  const scored = chunks.map((chunk, i) => {
    // NOTE: deliberately NOT remapping cosine from [-1,1] to [0,1] here.
    // Google's text-embedding-004 vectors aren't zero-centered — unrelated
    // text pairs still land ~0.3-0.5 raw cosine, and genuinely relevant
    // pairs land ~0.7-0.9. Remapping would compress that gap and make the
    // confidence threshold meaningless. Use raw cosine as the score.
    let score = cosineSimilarity(queryEmbedding, pageEmbeddings[i]);

    const sourceDomain = (chunk.source_domain || '').toLowerCase();
    if (query.toLowerCase().includes('manpower') && sourceDomain === 'manpowerx.co.in') score += 0.08;
    if (isBmtcQuery && /(^|\.)bookmytestcenter\.com$/.test(sourceDomain)) score += 0.1;
    if (siteProfile.domains.some(domain => sourceDomain === domain || sourceDomain.endsWith(`.${domain}`))) score += 0.06;

    return { chunk, score: Math.min(score, 1.0) };
  });

  // Cap chunks-per-URL so one giant page's many chunks can't crowd out
  // every slot — otherwise a 30,000-char homepage could still dominate
  // context the same way it did before chunking existed.
  const MAX_CHUNKS_PER_URL = 2;
  const perUrlCount = new Map();
  const topChunks = [];
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    const url = item.chunk.url;
    const count = perUrlCount.get(url) || 0;
    if (count >= MAX_CHUNKS_PER_URL) continue;
    perUrlCount.set(url, count + 1);
    topChunks.push(item);
    if (topChunks.length >= maxSnippets) break;
  }

  let finalContext = '';
  const contextLimit = 2500;
  const relatedSuggestions = new Set();

  for (const { chunk } of topChunks) {
    // No more slice(0, 1500) here — chunks are already ~900 chars each
    // (see CHUNKING section), so the full chunk is used as-is instead of
    // being re-truncated from its own start.
    const snippet = `Source: ${chunk.title} (${chunk.url})\n${chunk.content}\n\n---\n\n`;
    if (finalContext.length + snippet.length > contextLimit) break;
    finalContext += snippet;
    if (chunk.related_suggestions) {
      chunk.related_suggestions.forEach(s => relatedSuggestions.add(s));
    }
  }

  return {
    context: finalContext,
    confidenceScore: topChunks.length ? topChunks[0].score : 0,
    topPages: topChunks.map(p => ({ url: p.chunk.url, score: p.score })),
    relatedSuggestions: Array.from(relatedSuggestions).slice(0, 3)
  };
}

/**
 * Efficiently search the knowledge base using the pre-built keyword index.
 * FALLBACK ONLY — used when semantic search isn't available yet (startup)
 * or fails. Do not treat this as the primary retrieval path anymore.
 */
function searchRelevantContextKeyword(query, chunks, maxSnippets = 5, currentSite = 'testpan') {
  const expandedTerms = expandQueryWithSynonyms(query);
  const chunkScores = new Map();
  const isBmtcQuery = /\bbmtc\b|book\s*my\s*test\s*cent(?:er|re)|booking\s+portal|test\s*cent(?:er|re)\s+booking/i.test(query);
  const siteProfile = getSiteProfile(currentSite);

  // Use the index to find matching chunks and score them.
  expandedTerms.forEach(term => {
    const matchingChunks = searchIndex.get(term) || [];
    matchingChunks.forEach(chunkIndex => {
      chunkScores.set(chunkIndex, (chunkScores.get(chunkIndex) || 0) + 10);
    });
  });

  // Apply domain-specific and content-specific boosts to the scores.
  let maxScore = 0;
  for (const [chunkIndex, score] of chunkScores.entries()) {
    const chunk = chunks[chunkIndex];
    let newScore = score;
    const sourceDomain = (chunk.source_domain || '').toLowerCase();

    if (query.toLowerCase().includes('manpower') && sourceDomain === 'manpowerx.co.in') newScore += 50;
    if (isBmtcQuery && /(^|\.)bookmytestcenter\.com$/.test(sourceDomain)) newScore += 80;
    if (siteProfile.domains.some(domain => sourceDomain === domain || sourceDomain.endsWith(`.${domain}`))) newScore += 60;
    if ((query.toLowerCase().includes('leader') || query.toLowerCase().includes('ceo') || query.toLowerCase().includes('founder')) && (chunk.content.toLowerCase().includes('rajesh') || chunk.content.toLowerCase().includes('setia'))) newScore += 40;

    chunkScores.set(chunkIndex, newScore);
    if (newScore > maxScore) {
      maxScore = newScore;
    }
  }

  // Get the top-scoring chunks, capping how many can come from the same URL
  // so one long page's many chunks can't crowd out every slot.
  const MAX_CHUNKS_PER_URL = 2;
  const perUrlCount = new Map();
  const topPages = [];
  for (const [chunkIndex, score] of [...chunkScores.entries()].sort(([, a], [, b]) => b - a)) {
    const chunk = chunks[chunkIndex];
    const count = perUrlCount.get(chunk.url) || 0;
    if (count >= MAX_CHUNKS_PER_URL) continue;
    perUrlCount.set(chunk.url, count + 1);
    topPages.push({ page: chunk, score });
    if (topPages.length >= maxSnippets) break;
  }

  // Format the final context string from the top chunks, respecting the
  // character limit. No slice(0, 1500) here — each chunk is already ~900
  // chars (see CHUNKING section), so it's used in full rather than being
  // re-truncated from its own start.
  let finalContext = '';
  const contextLimit = 2500;
  const relatedSuggestions = new Set();

  for (const { page } of topPages) {
    const snippet = `Source: ${page.title} (${page.url})\n${page.content}\n\n---\n\n`;
    if (finalContext.length + snippet.length > contextLimit) break;
    finalContext += snippet;
    // Add related questions/topics for the fallback response
    if (page.related_suggestions) {
      page.related_suggestions.forEach(s => relatedSuggestions.add(s));
    }
  }

  // Normalize score to a 0-1 confidence value. A score of 150+ is high confidence.
  const confidenceScore = Math.min(maxScore / 150, 1.0);

  return {
    context: finalContext,
    confidenceScore,
    topPages: topPages.map(p => ({ url: p.page.url, score: p.score })),
    relatedSuggestions: Array.from(relatedSuggestions).slice(0, 3)
  };
}

/**
 * Primary retrieval entry point. Tries semantic search first; only falls
 * back to keyword matching if embeddings aren't ready or fail. This is the
 * function the rest of the file should call — do not call
 * searchRelevantContextKeyword() directly outside of this fallback.
 */
async function searchRelevantContext(query, pages, maxSnippets = 5, currentSite = 'testpan') {
  const semanticResult = await searchRelevantContextSemantic(query, pages, maxSnippets, currentSite);
  if (semanticResult) return semanticResult;

  console.log('[AI LOG] Semantic search unavailable, falling back to keyword search for:', query);
  return searchRelevantContextKeyword(query, pages, maxSnippets, currentSite);
}

/**
 * Build enhanced context with semantic search
 */
async function buildEnhancedContext(query, allChunks) {
  const relevantContext = await searchRelevantContext(query, allChunks);
  if (relevantContext.context.length > 0) {
    return relevantContext.context;
  }
  return contextText;
}

try {
  const knowledgeBaseData = fs.readFileSync(knowledgeBasePath, 'utf8');
  const parsedKb = JSON.parse(knowledgeBaseData);

  if (Array.isArray(parsedKb)) {
    knowledgeBasePages = parsedKb;
  } else {
    knowledgeBasePages = Object.entries(parsedKb).map(([key, value]) => ({
      url: value.url || '',
      title: key,
      content: typeof value === 'string' ? value : JSON.stringify(value),
      source_domain: new URL(value.url || 'https://testpanindia.com').hostname
    }));
  }

  contextText = formatContextFromPages(knowledgeBasePages);
  // Chunk BEFORE indexing/embedding — see CHUNKING section above. Everything
  // downstream (keyword index, embeddings, search) operates on chunks, not
  // whole raw pages, so long pages get searched section-by-section instead
  // of always returning just their first ~1500 characters.
  knowledgeChunks = buildKnowledgeChunks(knowledgeBasePages);
  searchIndex = buildSearchIndex(knowledgeChunks);

  const skippedJunk = knowledgeBasePages.filter(isJunkPage).length;
  console.log(`Knowledge base loaded: ${knowledgeBasePages.length} pages -> ${knowledgeChunks.length} searchable chunks (${skippedJunk} junk pages skipped).`);
} catch (error) {
  console.error('Failed to load knowledge base:', error);
}

// Build (or load cached) semantic embeddings in the background so server
// startup isn't blocked. Until this finishes, retrieval automatically
// falls back to keyword search (see searchRelevantContext above).
if (knowledgeChunks.length > 0) {
  buildPageEmbeddings(knowledgeChunks)
    .then(embeddings => {
      pageEmbeddings = embeddings;
      embeddingsReady = true;
      const missing = embeddings.filter(e => !e).length;
      console.log(`Embeddings ready: ${embeddings.length - missing}/${embeddings.length} chunks embedded${missing ? ` (${missing} failed)` : ''}.`);
    })
    .catch(error => {
      console.error('Failed to build chunk embeddings, staying on keyword search:', error);
    });
}

// System instruction - Enforces First-Person Identity ("We", "Our", "Us")
const SYSTEM_INSTRUCTION = `You are the official AI representative for the active Testpan group website. You speak directly ON BEHALF OF the active brand in the FIRST PERSON ("we", "our", "us"). Answer STRICTLY based on the official business details provided in the context below.
 
CRITICAL RULES:
1.  **First-Person Identity**: Always speak as "we," "our," "us." Never refer to Testpan, BMTC, or ManpowerX in the third person.
2.  **Grounding**: Answer ONLY from the provided context. Do not use external knowledge.
3.  **Language Consistency**:
    *   Detect the user's language on EVERY query.
    *   If the user asks in clean English, you MUST reply in English.
    *   If the user asks in Hinglish (e.g., using words like 'kaise', 'kya', 'kar sakte hain'), you MUST reply in conversational Roman-Hinglish.
    *   Never return a stored answer in a different language from the user's query. If the context is in English but the query is Hinglish, translate your answer to Hinglish.
4.  **Confidence & Fallback**:
    *   Only answer if the provided context confidently addresses the user's full question.
    *   If the context is insufficient or irrelevant, you MUST explicitly state you don't have that specific information.
    *   Then, offer 2-3 relevant suggested questions you CAN answer.
    *   Finally, provide a clear escalation path (support phone/email).
    *   NEVER invent answers or give a generic "contact us" response for a low-confidence match.
5.  **Sensitive Topics**: For questions about fraud, offer letters, or payments, be extra cautious. Do not confirm or deny anything. Instead, direct the user to an official verification channel mentioned in the context.

PRIORITY PORTAL ROUTING:
*   For registering a test centre: \`https://center.bookmytestcenter.com\`
*   For booking a test centre (as a client): \`https://client.bookmytestcenter.com\`
 
FALLBACK RULE:
- If details are NOT available in context, respond naturally and helpfully. For example: "Hmm, I don't have those exact details on hand right now. Would you like to connect with our support team at +91 98101 47334 or info@testpanindia.com?" Never say that information was not found "in the context."`;

function getGenerationConfig() {
  if (geminiThinkingDisabled) return undefined;
  // Gemini 3.8 Flash (current gemini-flash-latest) rejects 'minimal'.
  // 'low' is Google's documented replacement for latency-sensitive FAQ work.
  return {
    thinkingConfig: { thinkingLevel: PREFERRED_THINKING_LEVEL }
  };
}

function getGeminiModel({ forceNew = false } = {}) {
  if (geminiModel && !forceNew) {
    return geminiModel;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const generationConfig = getGenerationConfig();
    geminiModel = genAI.getGenerativeModel({
      model: GEMINI_FLASH_MODEL,
      ...(generationConfig ? { generationConfig } : {})
    });
    return geminiModel;
  } catch (error) {
    console.error('Failed to initialize Gemini AI:', error);
    return null;
  }
}

/**
 * Lazily-built model instance for GEMINI_FALLBACK_MODEL. Deliberately skips
 * thinkingConfig — this is only reached when the primary model is under
 * high demand, so we want the plainest, most broadly-compatible request
 * shape rather than risking a second failure mode (config rejection) on
 * top of the first (capacity).
 */
function getFallbackGeminiModel() {
  if (geminiFallbackModel) {
    return geminiFallbackModel;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    geminiFallbackModel = genAI.getGenerativeModel({ model: GEMINI_FALLBACK_MODEL });
    return geminiFallbackModel;
  } catch (error) {
    console.error('Failed to initialize Gemini fallback model:', error);
    return null;
  }
}

/**
 * Races a promise against a timeout so a single slow/overloaded attempt
 * can't hang the whole request indefinitely. Note this only stops us from
 * WAITING on the underlying HTTP call — it doesn't cancel it — but that's
 * fine here since we just want to move on to the fallback model quickly.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isGeminiConfigError(error) {
  if (error?.status && error.status !== 400) return false;
  const text = `${error?.message || ''} ${JSON.stringify(error?.errorDetails || '')}`.toLowerCase();
  return text.includes('invalid_argument')
    || text.includes('invalid argument')
    || text.includes('thinking')
    || text.includes('generation_config')
    || text.includes('generationconfig')
    || text.includes('not supported for this model');
}

function retryDelayMs(error) {
  const details = error?.errorDetails || [];
  const retryInfo = details.find(d => String(d['@type'] || '').includes('RetryInfo'));
  const seconds = parseFloat(String(retryInfo?.retryDelay || '').replace(/s$/i, ''));
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1000) + 250, 20000);
  }
  return 2000;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Opens a Gemini stream. If Google rejects the current generation config
 * (the recurring "they hot-swapped the alias" failure mode), drop
 * thinkingConfig, rebuild the model, and retry once so the bot stays up.
 * Also retries once on 429 so a free-tier burst doesn't take the bot down.
 */
/**
 * Non-streaming call. We ask Gemini for the complete response in one shot
 * instead of opening a long-lived SSE stream — this is what actually fixes
 * the "Failed to parse stream" crash/blank-response issue, which is a
 * property of streaming connections getting interrupted mid-flight on
 * flaky/free-tier networking. A plain request/response either fully
 * succeeds or fully fails; there's no partial state to corrupt.
 *
 * Because nothing is ever shown to the user until this function returns
 * successfully, it's safe to retry here — worst case it just adds latency,
 * it can never surface a half-sent answer the way the old streaming path
 * could. Each attempt is capped at GEMINI_ATTEMPT_TIMEOUT_MS so a slow or
 * 503-overloaded primary model can't stall the whole request; a generic
 * failure (including a timeout) falls back to GEMINI_FALLBACK_MODEL rather
 * than retrying the same possibly-overloaded model.
 */
async function generateContentSafe(prompt) {
  const model = getGeminiModel();
  try {
    return await withTimeout(model.generateContent(prompt), GEMINI_ATTEMPT_TIMEOUT_MS, 'Primary model request');
  } catch (error) {
    if (error?.status === 429) {
      const waitMs = retryDelayMs(error);
      console.warn(`[AI] Gemini rate-limited (429). Retrying once in ${waitMs}ms.`);
      await sleep(waitMs);
      return withTimeout(getGeminiModel().generateContent(prompt), GEMINI_ATTEMPT_TIMEOUT_MS, 'Primary model retry');
    }
    if (!geminiThinkingDisabled && isGeminiConfigError(error)) {
      console.warn(
        `[AI] Gemini rejected generation config on ${GEMINI_FLASH_MODEL}; retrying without thinkingConfig. Reason: ${error.message}`
      );
      geminiThinkingDisabled = true;
      geminiModel = null;
      const fallback = getGeminiModel({ forceNew: true });
      if (!fallback) throw error;
      return withTimeout(fallback.generateContent(prompt), GEMINI_ATTEMPT_TIMEOUT_MS, 'Config-fixed retry');
    }
    // Generic failure (network blip, 503 high-demand, timeout above, etc.)
    // — retry against a DIFFERENT model so we're not just re-queuing
    // behind the same overloaded capacity.
    const fallbackModel = getFallbackGeminiModel();
    if (!fallbackModel) throw error;
    console.warn(`[AI] Primary model failed (${error.message}). Retrying on fallback ${GEMINI_FALLBACK_MODEL}.`);
    try {
      return await withTimeout(fallbackModel.generateContent(prompt), GEMINI_ATTEMPT_TIMEOUT_MS, 'Fallback model request');
    } catch (fallbackError) {
      // The fallback ALSO failed. Retry it once after a short delay.
      const waitMs = retryDelayMs(fallbackError);
      console.warn(`[AI] Fallback model also failed (${fallbackError.message}). Retrying fallback once more in ${waitMs}ms.`);
      await sleep(waitMs);
      return withTimeout(fallbackModel.generateContent(prompt), GEMINI_ATTEMPT_TIMEOUT_MS, 'Fallback model retry');
    }
  }
}

export function isAIAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function getSiteFallbackContext(site) {
  if (site === 'manpower') {
    return `MANPOWERX - Active Site Context:
- Focus: Examination staffing, including invigilators, administrative staff, technical lab support, security, and exam-day operations.
- Support: info@testpanindia.com | +91 98101 47334
- Website: https://manpowerx.co.in`;
  }

  if (site === 'bmtc') {
    return `BOOKMYTESTCENTER - Active Site Context:
- Focus: Finding, verifying, booking, and managing examination centres.
- Client / exam hosting portal: https://client.bookmytestcenter.com
- Test-centre registration portal: https://center.bookmytestcenter.com
- Support: info@testpanindia.com | +91 98101 47334`;
  }

  return `TESTPAN INDIA - Active Site Context:
- Focus: Examination infrastructure, centre management, auxiliary services, and support.
- Support: info@testpanindia.com | +91 98101 47334
- Website: https://testpanindia.com`;
}

/**
 * Provides instant answers for common, static questions to reduce API latency.
 * @param {string} query - The normalized user query.
 * @returns {string|null} The answer text or null if no fast-path match.
 */
function getFastPathResponse(query) {
  const lowerQuery = query.toLowerCase();
  const wordCount = lowerQuery.trim().split(/\s+/).filter(Boolean).length;

  // "Complexity" markers: if any of these appear, the user wants something
  // specific/nuanced, not the generic blurb — route to full RAG instead.
  // This list previously only protected the manpower shortcut, which is why
  // e.g. "Is there a mobile app for BookMyTestCenter?" (contains "bmtc"-ish
  // wording via "bookmytestcenter") was hijacked into a canned answer that
  // never mentions an app at all. Now it protects every shortcut below.
  const isComplexQuery = /\b(cost|price|app|download|available|confirm|verify|dates?|seats?|register|enroll|list|earn|money)\b/i.test(lowerQuery);

  const hinglish = isHinglishQuery(lowerQuery);
  const isIdentityQuery =
    lowerQuery.includes('location') || lowerQuery.includes('address') || lowerQuery.includes('kahan') || lowerQuery === 'where' ||
    lowerQuery.includes('contact') || lowerQuery.includes('support') || lowerQuery.includes('email') || lowerQuery.includes('phone') ||
    lowerQuery.includes('ceo') || lowerQuery.includes('founder') || lowerQuery.includes('leader');

  // Static identity facts should not depend on the 6-word gate.
  // "Who is the CEO of Testpan India?" is 7 words and used to miss the shortcut.
  if (wordCount <= 14 && isIdentityQuery) {
    if (lowerQuery.includes('ceo') || lowerQuery.includes('founder') || lowerQuery.includes('leader')) {
      return hinglish
        ? 'Hamare Founder, CEO, aur Managing Director Mr. Rajesh Setia hain. Unhone Testpan India ki shuruaat 2016 mein ki thi.'
        : 'Our Founder, CEO, and Managing Director is Mr. Rajesh Setia. He founded Testpan India in 2016.';
    }
    if (lowerQuery.includes('location') || lowerQuery.includes('address') || lowerQuery.includes('kahan') || lowerQuery === 'where') {
      return hinglish
        ? 'Hum New Delhi se operate karte hain. Hamara corporate office 1390/7, 2nd Floor, Pankha Road, Nangal Raya, New Delhi – 110046 par hai.'
        : 'We operate from New Delhi. Our corporate office is located at 1390/7, 2nd Floor, Pankha Road, Nangal Raya, New Delhi – 110046.';
    }
    if (lowerQuery.includes('contact') || lowerQuery.includes('support') || lowerQuery.includes('email') || lowerQuery.includes('phone')) {
      return hinglish
        ? 'Aap hamari support team se +91 98101 47334 par ya info@testpanindia.com par email karke contact kar sakte hain.'
        : 'You can reach our support team by phone at +91 98101 47334 or by email at info@testpanindia.com.';
    }
  }

  // Keep BMTC/Manpower blurbs strictly short and simple so a nuanced
  // question (e.g. "Is there a mobile app for BookMyTestCenter?") still
  // goes to RAG instead of a generic portal blurb.
  if (wordCount <= 6 && !isComplexQuery) {
    if (/\b(bmtc|bookmytestcenter)\b/i.test(lowerQuery) && !lowerQuery.includes('testpan')) {
      return 'BookMyTestCenter (BMTC) is our online portal for finding, verifying, and booking examination centers across India. Clients can use it to hire centers, and center owners can register to partner with us.';
    }
    if (/\b(manpowerx|mpx|manpower)\b/i.test(lowerQuery) && !lowerQuery.includes('testpan')) {
      return 'ManpowerX is our specialized staffing service. We provide skilled personnel like invigilators, technical support, and administrative staff for conducting examinations smoothly.';
    }
  }

  // Fast-path for common app/pricing questions, but only if they are not complex.
  if (wordCount <= 8 && !isComplexQuery) {
    if (/\b(app|mobile|android|ios)\b/i.test(lowerQuery)) {
      return hinglish
        ? 'Haan, hamari "BookMyTestCenter" app Google Play Store aur Apple App Store dono par available hai.'
        : 'Yes, our "BookMyTestCenter" app is available on both the Google Play Store and the Apple App Store.';
    }
    if (/\b(pricing|cost|charges|rate|fee)\b/i.test(lowerQuery)) {
      return hinglish
        ? 'Pricing ke details ke liye, please hamari sales team se [info@testpanindia.com](mailto:info@testpanindia.com) par sampark karein. Woh aapki zaroorat ke hisab se best plan batayenge.'
        : 'For pricing details, please contact our sales team at [info@testpanindia.com](mailto:info@testpanindia.com). They can provide a quote tailored to your specific needs.';
    }
  }

 // Fast-path for becoming a test center.
// This is intentionally checked before Gemini so important
// registration questions never wait for the AI service.
if (
  /(become|register|partner|official|my\s+(college|lab|center|school)|college|university|institution)/i.test(lowerQuery) &&
  /(?:test\s*cent(?:er|re)|testpan\s*cent(?:er|re)|exam\s*cent(?:er|re))/i.test(lowerQuery)
) {
  return hinglish
    ? 'Aap hamare saath ek official test center banne ke liye https://center.bookmytestcenter.com par register kar sakte hain. Wahan aapko saari jaankari mil jayegi.'
    : 'You can partner with us and become an official test center by registering on our portal: https://center.bookmytestcenter.com. All the details and requirements are available there.';
}

  // NOTE: this used to also have an unconditional
  // `if (getPortalIntent(lowerQuery)) return getFallbackResponse(lowerQuery);`
  // here, OUTSIDE the wordCount/complexity gate above. That meant ANY query
  // containing e.g. "book" + "centers" — including long, nuanced ones like
  // "How do I find and book exam centers in a specific city for my
  // company's exam?" — got redirected to the generic portal link, even
  // after webHandler.js's own (properly gated) portal-intent check had
  // already decided the query was too complex for that shortcut and passed
  // it through to the AI pipeline. This function only runs once webHandler
  // has already made that call, so re-deciding it here — ungated — was
  // silently overriding the upstream fix. Portal-intent handling now lives
  // in exactly one gated place (webHandler.js's isSimplePortalQuery), plus
  // the last-resort check inside getFallbackResponse() for when the AI
  // itself is unavailable. Don't re-add an ungated check here.
  return null;
}

export async function processAIQuery(query, currentSite = 'testpan') {
  // --- Diagnostic timing (grep for "[AI TIMING]" in logs; safe to remove later) ---
  const requestStart = Date.now();
  const model = getGeminiModel();
  const site = normalizeSite(currentSite);
  const siteProfile = getSiteProfile(site);
  const normalizedQuery = normalizeUserQuery(query);

  if (!model) {
    throw new Error('AI model not available. Please check GEMINI_API_KEY configuration.');
  }

  try {
    // Fast-path for common static questions
    const fastPathAnswer = getFastPathResponse(normalizedQuery);
    if (fastPathAnswer) {
      console.log(`[AI TIMING] "${query}" — resolved via fast-path lookup.`);
      return {
        success: true,
        text: fastPathAnswer,
        source: 'fastpath',
        buttons: [{ label: "🏠 Main Menu", value: "menu" }]
      };
    }

    const searchStart = Date.now();
    let retrievalResult = {
      context: '',
      confidenceScore: 0,
      topPages: [],
      relatedSuggestions: []
    };
    if (knowledgeChunks.length > 0) {
      retrievalResult = await searchRelevantContext(normalizedQuery, knowledgeChunks, 5, site);
    }

    let { context: relevantContext, confidenceScore, topPages, relatedSuggestions } = retrievalResult;

    // 4. Implement the "confidence gate"
    // Threshold is tuned for RAW cosine similarity from text-embedding-004
    // (see note in searchRelevantContextSemantic). If the keyword fallback
    // path fires instead (embeddings not ready yet), its score is normalized
    // differently (0-1 via maxScore/150) — log confidenceScore + source in
    // production for a week and re-tune this number against real traffic
    // rather than trusting this as final.
    const CONFIDENCE_THRESHOLD = 0.6;
    if (confidenceScore < CONFIDENCE_THRESHOLD) {
      console.log(`[AI LOG] Low confidence (${confidenceScore.toFixed(2)}) for query: "${query}". Triggering fallback.`);
      console.log(`   Top retrieved chunks:`, topPages);

      let fallbackText = `I'm sorry, I don't have specific information about that. However, I can help with topics like:\n`;
      if (relatedSuggestions.length > 0) {
        fallbackText += relatedSuggestions.map(s => `*   ${s}`).join('\n');
      } else {
        fallbackText += `*   Our services\n*   How to partner with us\n*   Information about our company`;
      }
      fallbackText += `\n\nWould one of those be helpful, or would you like to connect with our support team at **+91 98101 47334** or **info@testpanindia.com**?`;

      return {
        success: true,
        text: fallbackText,
        source: 'ai-fallback-low-confidence'
      };
    }
    
    if (!relevantContext || relevantContext.length < 50) {
      relevantContext = `TESTPAN INDIA - Corporate Overview:
      
COMPANY INFORMATION:
- Founded: 2016
- CEO & Founder: Rajesh Setia
- Headquarters: India
- Industry: Examination & Testing Infrastructure, Staffing Solutions, Test Center Management

KEY LEADERSHIP:
- CEO Rajesh Setia leads our organization with focus on technology-driven examination delivery.
- Our management team oversees all core business operations including test centers, manpower services, and platform development.

CORE SERVICES & PLATFORMS:
1. Computer-Based Testing (CBT) Infrastructure: End-to-end exam center setup and management nationwide
2. BookMyTestCenter: Our online portal for booking and managing exam centers across India
3. ManpowerX: Specialized staffing solutions providing invigilators, administrative staff, technical support, and security personnel for exam deployments

BUSINESS REACH:
- Pan-India deployment capability across major metros and tier-2/3 cities
- Experience managing high-volume exam deployments (100+ simultaneous test centers)

CONTACT DETAILS:
- Phone: +91 98101 47334
- Email: info@testpanindia.com  
- Website: https://testpanindia.com
- Client booking portal: https://client.bookmytestcenter.com
- Test centre registration portal: https://center.bookmytestcenter.com

Source: Testpan India Corporate Database`;
    }
    console.log(`[AI TIMING] "${query}" — knowledge base search: ${Date.now() - searchStart}ms, confidence: ${confidenceScore.toFixed(2)}`);

    const contextualQuery = `${SYSTEM_INSTRUCTION}\n\n[ACTIVE SITE]\nKey: ${siteProfile.key}\nBrand: ${siteProfile.name}\nPrimary context: ${siteProfile.primaryContext}\nPriority domains: ${siteProfile.domains.join(', ')}\n\n[KNOWLEDGE BASE CONTEXT]\n${relevantContext}\n\n[USER QUERY]\n${query}\n\n[NORMALIZED INTENT WORDING]\n${normalizedQuery}`;

    // Non-streaming call: we get the complete answer in one request/response
    // instead of a long-lived SSE connection. webHandler.js then simulates
    // the "typing" effect on the already-complete text. This trades true
    // first-token latency for reliability — a free-tier connection dropping
    // mid-response can no longer leave the user with a half-sent answer,
    // because nothing is shown until the full text is already in hand.
    const apiCallStart = Date.now();
    const result = await generateContentSafe(contextualQuery);
    const text = result.response.text();
    console.log(`[AI TIMING] "${query}" — model.generateContent() resolved in ${Date.now() - apiCallStart}ms | total: ${Date.now() - requestStart}ms`);

    return {
      success: true,
      text,
      source: 'ai',
      timing: { requestStart, query }
    };

 } catch (error) {
  console.error(
    `[AI TIMING] "${query}" failed after ${Date.now() - requestStart}ms:`,
    error
  );

  const fallbackText = getFallbackResponse(
    query,
    site
  );

  return {
    success: true,
    text: fallbackText,
    source: 'ai-fallback-error',
    buttons: [
      {
        label: "🏠 Main Menu",
        value: "menu"
      }
    ]
  };
}
}

export function shouldUseAI(query) {
  const lowerQuery = normalizeUserQuery(query);
  
  const menuPatterns = /^(1|2|3|4|5|0|menu|back|main menu|start|hi|hello|hey|hii|hiii|helo|hola|namaste|pranam|good morning|good afternoon|good evening)$/i;
  if (menuPatterns.test(lowerQuery)) {
    return false;
  }
  
  const specificPatterns = /^(\d+\.\d+|\d)$/i;
  if (specificPatterns.test(lowerQuery)) {
    return false;
  }
  
  const englishQuestionWords = [
    'who', 'what', 'where', 'when', 'how', 'why', 'which', 'can', 'could', 'would', 
    'should', 'is', 'are', 'do', 'does', 'tell', 'explain', 'describe', 'provide', 
    'list', 'give', 'show', 'help', 'what\'s', 'what is', 'how\'s', 'how is'
  ];
  
  const hasEnglishQuestion = englishQuestionWords.some(word => lowerQuery.includes(word));
  // Reuses the shared HINGLISH_MARKERS list (see top of file) instead of its
  // own separate copy, so this and getFallbackResponse/getFastPathResponse
  // can never drift out of sync on what counts as Hinglish.
  const hasHinglishQuestion = isHinglishQuery(lowerQuery);
  
  const isComplexQuery = lowerQuery.length > 3 && !/^\d+$/.test(lowerQuery);
  
  return hasEnglishQuestion || hasHinglishQuestion || isComplexQuery;
}

export function getFallbackResponse(query, currentSite = 'testpan') {
  const lowerQuery = normalizeUserQuery(query);
  const site = normalizeSite(currentSite);
  const portalIntent = getPortalIntent(lowerQuery);
  const hinglish = isHinglishQuery(query);

  if (portalIntent === 'centre-registration') {
    return 'To register or partner your test centre with us, please visit https://center.bookmytestcenter.com.';
  }

  if (portalIntent === 'client-booking') {
    return 'To book test centres or host an exam as a client, please visit https://clients.bookmytestcenter.com.';
  }

  if (lowerQuery.includes('ceo') || lowerQuery.includes('founder')) {
    return 'We were founded in 2016 by Rajesh Setia, who serves as our CEO.';
  }

  if (lowerQuery.includes('location') || lowerQuery.includes('where') || lowerQuery.includes('address') || lowerQuery.includes('kahan')) {
    return 'We operate from New Delhi. Our corporate office is located at 1390/7, 2nd Floor, Pankha Road, Nangal Raya, New Delhi – 110046.';
  }

  // THE BUG: this branch previously returned a hardcoded Hinglish string
  // ("Aap hamari team se ... contact kar sakte hain") for ANY query
  // containing "contact"/"phone"/"email" — including clean English ones.
  // That's the exact English-in, Hinglish-out leak you reported. It never
  // checked the query's language at all. Now it branches on isHinglishQuery().
  if (lowerQuery.includes('contact') || lowerQuery.includes('phone') || lowerQuery.includes('email')) {
    return hinglish
      ? 'Aap hamari team se +91 98101 47334 ya info@testpanindia.com par contact kar sakte hain.'
      : 'You can reach our team at +91 98101 47334 or email info@testpanindia.com.';
  }

  if (lowerQuery.includes('service') || lowerQuery.includes('offer')) {
    return 'We offer test center booking, center management tools, IT support, manpower services (ManpowerX), and exam support services.';
  }

  if (site === 'manpower') {
    return hinglish
      ? 'Mujhe abhi wo exact ManpowerX details nahi mil rahi. Hamari staffing support team +91 98101 47334 ya info@testpanindia.com par help kar sakti hai.'
      : 'I do not have those exact ManpowerX details on hand right now. Our staffing support team can help at +91 98101 47334 or info@testpanindia.com.';
  }

  if (site === 'bmtc') {
    return hinglish
      ? 'Mujhe abhi wo exact BookMyTestCenter details nahi mil rahi. Kripya +91 98101 47334 ya info@testpanindia.com par contact karein.'
      : 'I do not have those exact BookMyTestCenter details on hand right now. Please contact us at +91 98101 47334 or info@testpanindia.com.';
  }

  return hinglish
    ? "Mujhe abhi wo exact details nahi mil rahi hain. Kya aap hamari support team se +91 98101 47334 ya info@testpanindia.com par connect karna chahenge?"
    : "I don't have those exact details on hand right now. Would you like to connect with our support team at +91 98101 47334 or info@testpanindia.com?";
}