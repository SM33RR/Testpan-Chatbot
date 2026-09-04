import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSiteProfile, normalizeSite } from '../config/siteConfig.js';
import { getPortalIntent, normalizeUserQuery } from './intentMatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let geminiModel = null;

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
 * Efficiently search the knowledge base using the pre-built index.
 */
function searchRelevantContext(query, pages, maxSnippets = 3, currentSite = 'testpan') {
  const expandedTerms = expandQueryWithSynonyms(query);
  const pageScores = new Map();
  const isBmtcQuery = /\bbmtc\b|book\s*my\s*test\s*cent(?:er|re)|booking\s+portal|test\s*cent(?:er|re)\s+booking/i.test(query);
  const siteProfile = getSiteProfile(currentSite);

  // Use the index to find matching pages and score them.
  expandedTerms.forEach(term => {
    const matchingPages = searchIndex.get(term) || [];
    matchingPages.forEach(pageIndex => {
      pageScores.set(pageIndex, (pageScores.get(pageIndex) || 0) + 10);
    });
  });

  // Apply domain-specific and content-specific boosts to the scores.
  for (const [pageIndex, score] of pageScores.entries()) {
    const page = pages[pageIndex];
    let newScore = score;
    const sourceDomain = (page.source_domain || '').toLowerCase();

    if (query.toLowerCase().includes('manpower') && sourceDomain === 'manpowerx.co.in') newScore += 50;
    if (isBmtcQuery && /(^|\.)bookmytestcenter\.com$/.test(sourceDomain)) newScore += 80;
    if (siteProfile.domains.some(domain => sourceDomain === domain || sourceDomain.endsWith(`.${domain}`))) newScore += 60;
    if ((query.toLowerCase().includes('leader') || query.toLowerCase().includes('ceo') || query.toLowerCase().includes('founder')) && (page.content.toLowerCase().includes('rajesh') || page.content.toLowerCase().includes('setia'))) newScore += 40;

    pageScores.set(pageIndex, newScore);
  }

  // Get the top N scoring page indices.
  const topPageIndices = [...pageScores.entries()]
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .slice(0, maxSnippets)
    .map(([pageIndex]) => pageIndex);

  // Format the final context string from the top pages.
  return topPageIndices
    .map(index => pages[index])
    .map(p => `Source: ${p.title} (${p.url})\n${p.content.slice(0, 1500)}...`)
    .join('\n\n---\n\n');
}

/**
 * Build enhanced context with semantic search
 */
function buildEnhancedContext(query, allPages) {
  const relevantContext = searchRelevantContext(query, allPages);
  if (relevantContext.length > 0) {
    return relevantContext;
  }
  return contextText;
}

try {
  const knowledgeBaseData = fs.readFileSync(knowledgeBasePath, 'utf8');
  const parsedKb = JSON.parse(knowledgeBaseData);

  if (Array.isArray(parsedKb)) {
    knowledgeBasePages = parsedKb;
    contextText = formatContextFromPages(parsedKb);
    searchIndex = buildSearchIndex(knowledgeBasePages);
  } else {
    knowledgeBasePages = Object.entries(parsedKb).map(([key, value]) => ({
      url: value.url || '',
      title: key,
      content: typeof value === 'string' ? value : JSON.stringify(value),
      source_domain: new URL(value.url || 'https://testpanindia.com').hostname
    }));
    contextText = formatContextFromPages(knowledgeBasePages);
    searchIndex = buildSearchIndex(knowledgeBasePages);
  }
  
  console.log(`Knowledge base loaded: ${knowledgeBasePages.length} pages indexed`);
} catch (error) {
  console.error('Failed to load knowledge base:', error);
}

// System instruction - Enforces First-Person Identity ("We", "Our", "Us")
const SYSTEM_INSTRUCTION = `You are the official AI representative for the active Testpan group website. You speak directly ON BEHALF OF the active brand in the FIRST PERSON ("we", "our", "us"). Answer STRICTLY based on the official business details provided in the context below.

CRITICAL GROUNDING & PERSONA RULES:
1. Always speak in FIRST PERSON ("we", "our", "us"). Say "We offer...", "Our CEO Rajesh Setia...", "Our service ManpowerX...", "Contact us at...". NEVER refer to Testpan India in third person (do NOT say "Testpan is a company that..." or "They provide...").
2. Answer using ONLY information from the provided context. DO NOT use generic pre-trained assumptions.
3. Keep responses clear, professional, well-formatted, and under 3-4 sentences.
4. The runtime provides an ACTIVE SITE profile. Retain access to all company knowledge, but prioritize the active site's services, contact details, support channels, and source pages. Do not lead with another brand unless the user asks for it.

PRIORITY PORTAL ROUTING (never substitute another domain):
- Centre owners who want to register, onboard, or partner a test centre must be sent to https://center.bookmytestcenter.com.
- Clients who want to book/hire test centres, conduct an exam, or host an exam must be sent to https://client.bookmytestcenter.com.
- Treat spelling variants and Roman-Hindi/Hinglish equivalents as the same intent: "regster" means register; "bok" means book; "test cntr", "exam hall", "pariksha kendra", and "center" refer to a test centre; and "jodna" can mean register/onboard.

SEMANTIC INFERENCE RULES:
- Treat terms like "CEO", "Founder", "Director", "Leader", "Head", and "Management" interchangeably - they refer to our leadership team.
- When a user asks about "leaders", "founders", or "management", synthesize information about our CEO & Founder Rajesh Setia from the context.
- You may naturally connect related concepts across the context (e.g., if context mentions "CEO Rajesh Setia" and "founded in 2016", synthesize that our founder Rajesh Setia established the company in 2016).

LANGUAGE & HINGLISH RULES:
- STRICT LANGUAGE RULE: Detect the user's input language before responding. If the query contains Hinglish/Roman-Hindi keywords such as "kya", "kaise", "kar", "sakte", "hain", "batao", "kaun", or "par", you MUST write your ENTIRE response in polite, conversational Roman-script Hinglish. Never reply in English to a Hinglish question.
- For a Hinglish query, retain useful English product names and technical terms, but write the explanation and call to action in Roman Hinglish. For example: "BMTC (BookMyTestCenter) portal par aap test centres search, verify aur book kar sakte hain."
- If the user writes in standard English, respond in crisp, professional English.

FALLBACK RULE:
- If details are NOT available in context, respond naturally and helpfully. For example: "Hmm, I don't have those exact details on hand right now. Would you like to connect with our support team at +91 98101 47334 or info@testpanindia.com?" Never say that information was not found "in the context."`;

function getGeminiModel() {
  if (geminiModel) {
    return geminiModel;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    geminiModel = genAI.getGenerativeModel({ 
      model: 'gemini-3.6-flash',
      systemInstruction: SYSTEM_INSTRUCTION
    });
    return geminiModel;
  } catch (error) {
    console.error('Failed to initialize Gemini AI:', error);
    return null;
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

export async function processAIQuery(query, currentSite = 'testpan') {
  const model = getGeminiModel();
  const site = normalizeSite(currentSite);
  const siteProfile = getSiteProfile(site);
  const normalizedQuery = normalizeUserQuery(query);

  if (!model) {
    throw new Error('AI model not available. Please check GEMINI_API_KEY configuration.');
  }

  try {
    let relevantContext = '';
    if (knowledgeBasePages.length > 0) {
      relevantContext = searchRelevantContext(normalizedQuery, knowledgeBasePages, 3, site);
    }
    
    if (!relevantContext || relevantContext.length < 50) {
      relevantContext = getSiteFallbackContext(site);
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

    const contextualQuery = `[ACTIVE SITE]\nKey: ${siteProfile.key}\nBrand: ${siteProfile.name}\nPrimary context: ${siteProfile.primaryContext}\nPriority domains: ${siteProfile.domains.join(', ')}\n\n[KNOWLEDGE BASE CONTEXT]\n${relevantContext}\n\n[USER QUERY]\n${query}\n\n[NORMALIZED INTENT WORDING]\n${normalizedQuery}`;

    const result = await model.generateContent(contextualQuery);
    const response = await result.response;
    const text = response.text();

    return {
      success: true,
      response: text.trim(),
      source: 'ai',
      contextLength: relevantContext.length
    };

  } catch (error) {
    console.error('AI processing error:', error);
    return {
      success: false,
      error: error.message,
      source: 'ai'
    };
  }
}

export function shouldUseAI(query) {
  const lowerQuery = normalizeUserQuery(query);
  
  const menuPatterns = /^(1|2|3|4|5|0|menu|back|main menu|start|hi|hello|hey|hii|hiii|helo|hola)$/i;
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
  
  const hinglishQuestionWords = [
    'kya', 'kaise', 'kab', 'kahan', 'batao', 'kaun', 'kyun', 'kya hai', 'kaise ho',
    'kya kar', 'kya hota', 'kya tha', 'kya ek', 'kya aap', 'kya milta',
    'bata', 'batao', 'bataiye', 'samjha', 'samjhao', 'samjhiye',
    'haan', 'nahi', 'hai', 'hain', 'ho', 'karo', 'kar', 'karega', 'karoge',
    'dusara', 'doosra', 'aur', 'ya', 'yaa', 'malum', 'jaaniye', 'suno'
  ];
  
  const hasEnglishQuestion = englishQuestionWords.some(word => lowerQuery.includes(word));
  const hasHinglishQuestion = hinglishQuestionWords.some(word => lowerQuery.includes(word));
  
  const isComplexQuery = lowerQuery.length > 3 && !/^\d+$/.test(lowerQuery);
  
  return hasEnglishQuestion || hasHinglishQuestion || isComplexQuery;
}

export function getFallbackResponse(query, currentSite = 'testpan') {
  const lowerQuery = normalizeUserQuery(query);
  const site = normalizeSite(currentSite);
  const portalIntent = getPortalIntent(lowerQuery);

  if (portalIntent === 'centre-registration') {
    return 'To register or partner your test centre with us, please visit https://center.bookmytestcenter.com.';
  }

  if (portalIntent === 'client-booking') {
    return 'To book test centres or host an exam as a client, please visit https://client.bookmytestcenter.com.';
  }
  
  if (lowerQuery.includes('ceo') || lowerQuery.includes('founder')) {
    return 'We were founded in 2016 by Rajesh Setia, who serves as our CEO.';
  }
  
  if (lowerQuery.includes('location') || lowerQuery.includes('where') || lowerQuery.includes('address') || lowerQuery.includes('kahan')) {
    return 'We operate from New Delhi. Our corporate office is located at 1390/7, 2nd Floor, Pankha Road, Nangal Raya, New Delhi – 110046.';
  }
  
  if (lowerQuery.includes('contact') || lowerQuery.includes('phone') || lowerQuery.includes('email')) {
    return 'Aap hamari team se +91 98101 47334 ya info@testpanindia.com par contact kar sakte hain.';
  }
  
  if (lowerQuery.includes('service') || lowerQuery.includes('offer')) {
    return 'We offer test center booking, center management tools, IT support, manpower services (ManpowerX), and exam support services.';
  }

  if (site === 'manpower') {
    return 'Hmm, I do not have those exact ManpowerX details on hand right now. Our staffing support team can help at +91 98101 47334 or info@testpanindia.com.';
  }

  if (site === 'bmtc') {
    return 'Hmm, I do not have those exact BookMyTestCenter details on hand right now. Please contact us at +91 98101 47334 or info@testpanindia.com.';
  }

  return "Hmm, I don't have those exact details on hand right now. Would you like to connect with our support team at +91 98101 47334 or info@testpanindia.com?";
}
