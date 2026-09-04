import {
  processAIQuery,
  shouldUseAI,
  isAIAvailable,
  getFallbackResponse,
} from "./aiHandler.js";
import { getSiteProfile, normalizeSite } from "../config/siteConfig.js";
import { getPortalIntent, normalizeUserQuery } from './intentMatcher.js';

const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { state: 'GREETING', lead: {} });
  }
  return sessions.get(sessionId);
}

export function updateSession(sessionId, data) {
  const session = getSession(sessionId);
  sessions.set(sessionId, { ...session, ...data });
  return getSession(sessionId);
}

/**
 * Validates and normalizes a 10-digit Indian mobile number.
 * @param {string} phone - The input phone number.
 * @returns {string|null} The 10-digit number or null if invalid.
 */
function validateIndianPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;
  // Strip common prefixes like +91, 91, 0
  const strippedPhone = phone.replace(/^(?:\+91|91|0)/, '');
  // Check if it's a valid 10-digit number starting with 6, 7, 8, or 9
  if (/^[6-9]\d{9}$/.test(strippedPhone)) {
    return strippedPhone;
  }
  return null;
}
/**
 * Process incoming web/socket message and return structured response
 * @param {string} sessionId - Unique identifier for the session/socket
 * @param {string} messageBody - User's message text
 * @param {string} currentSite - Active website identity from the Socket.IO handshake
 * @returns {Promise<Object>} Response object with text and buttons
 */
export async function processMessage(sessionId, messageBody, currentSite = "testpan") {
  const body = (messageBody || "").trim();
  const site = normalizeSite(currentSite);
  const session = getSession(sessionId);
  const siteProfile = getSiteProfile(site);

  if (!body) {
    return {
      text: "Please send a message.",
      buttons: [
        { label: "🏠 Main Menu", value: "menu" }
      ]
    };
  }

  try {
    const lowerBody = normalizeUserQuery(body);

    
    // 1. Intercept Static Navigation & Menu Commands First
    if (lowerBody === "menu" || lowerBody === "0") {
      updateSession(sessionId, { state: 'GREETING' });
      return getMainMenuResponse(site);
    }

    // These are business-critical destinations. Resolve them locally before AI/RAG
    // so the correct portal is returned instantly and cannot be overridden by context.
    const portalResponse = getPortalResponse(lowerBody);
    if (portalResponse) {
      return portalResponse;
    }

    if (lowerBody === "1") {
      const response = {
        text: "💻 **Our Services**\n\nWe specialize in a range of examination solutions:\n\n*   **Computer-Based Testing (CBT)**: End-to-end infrastructure for online exams.\n*   **Exam Center Management**: Comprehensive management of test venues.\n*   **ManpowerX**: Our dedicated workforce and staffing solution.\n*   **BookMyTestCenter**: A one-stop portal for booking exam centers.",
        buttons: [
          { label: "⬅️ Back", value: "0" },
          { label: "🏠 Main Menu", value: "menu" }
        ]
      };
      return updateSessionAndReturn(sessionId, { state: 'LEAD_PROMPT', purpose: 'Our Services' }, response);
    }

    if (lowerBody === "2") {
      const response = {
        text: "🤝 **Partner With Us**\n\nWe are always looking to partner with institutions, colleges, and testing centers nationwide. Reach out to our team to learn how you can set up a certified exam venue with our full IT and security support.",
        buttons: [
          { label: "⬅️ Back", value: "0" },
          { label: "🏠 Main Menu", value: "menu" }
        ]
      };
      return updateSessionAndReturn(sessionId, { state: 'LEAD_PROMPT', purpose: 'Partner with us' }, response);
    }

    if (lowerBody === "3") {
      const response = {
        text: "ℹ️ **About Testpan India**\n\nFounded in 2016 by our CEO, **Mr. Rajesh Setia**, Testpan India is a premier provider of examination center management, IT infrastructure, and computer-based testing (CBT) solutions across India.",
        buttons: [
          { label: "⬅️ Back", value: "0" },
          { label: "🏠 Main Menu", value: "menu" }
        ]
      };
      return updateSessionAndReturn(sessionId, { state: 'LEAD_PROMPT', purpose: 'About Testpan India' }, response);
    }

    if (lowerBody === "4") {
      const response = {
        text: "⁉️ **Frequently Asked Questions**\n\n*   **How do I book a test center for an exam?**\n    You can visit our client portal at https://client.bookmytestcenter.com\n\n*   **How do I register my test center?**\n    To partner with us, please register at https://center.bookmytestcenter.com\n\n*   **What is ManpowerX?**\n    ManpowerX is our dedicated staffing solution for invigilators and exam staff.\n\nFeel free to type your own question below to ask our AI assistant!",
        buttons: [
          { label: "⬅️ Back", value: "0" },
          { label: "🏠 Main Menu", value: "menu" }
        ]
      };
      return updateSessionAndReturn(sessionId, { state: 'GREETING' }, response);
    }

    if (lowerBody === "5") {
      return {
        text: "📲 **Customer Support**\n\nYou can reach our support team directly by:\n\n*   **Phone**: [+91 98101 47334](tel:+919810147334)\n*   **Email**: [info@testpanindia.com](mailto:info@testpanindia.com)",
        buttons: [
          { label: "⬅️ Back", value: "0" },
          { label: "🏠 Main Menu", value: "menu" }
        ]
      };
    }

    // Handle lead collection states BEFORE attempting to use AI
    if (session.state === 'LEAD_PROMPT') {
      // Check if the user is asking a question instead of providing a name
      if (shouldUseAI(body)) {
        // The user asked a question, so we fall through to the AI handler below.
      } else {
        updateSession(sessionId, { state: 'LEAD_CAPTURE', lead: { name: body } });
        return {
          text: `Got it, ${body}! And what's the best phone number to reach you at?`,
          buttons: [{ label: "🏠 Main Menu", value: "menu" }]
        };
      }
    }

    // 2. Route Natural Language Questions to AI, even during lead capture
    if (shouldUseAI(body)) {
      if (isAIAvailable()) {
        const aiResult = await processAIQuery(body, site);
        if (aiResult.success) {
          // If the result is a stream, return it directly for the server to handle.
          // This is the fix for the 'undefined' bug.
          return aiResult;
        }
      }
      // Fallback if AI is disabled or fails, but still answer the question
      return {
        text: getFallbackResponse(body, site),
        buttons: [
          { label: "⬅️ Back", value: "0" },
          { label: "🏠 Main Menu", value: "menu" }
        ]
      };
    }

    if (session.state === 'LEAD_CAPTURE') {
      const validatedPhone = validateIndianPhoneNumber(body);
      if (!validatedPhone) {
        return {
          text: "Please enter a valid 10-digit Indian mobile number (e.g., 9876543210) so our team can reach out to you.",
          buttons: [{ label: "🏠 Main Menu", value: "menu" }]
        };
      }

      const finalSession = updateSession(sessionId, { state: 'GREETING', lead: { ...session.lead, phone: body } });
      return {
        text: `Thanks, ${finalSession.lead.name}! Our team will reach out to you shortly. Is there anything else I can help with?`,
        buttons: getMainMenuResponse().buttons,
        leadData: { 
          ...finalSession.lead, 
          purposeOfVisit: finalSession.purpose,
          websiteVisited: siteProfile.name 
        }
      };
    }

    // Default response if input is unrecognized
    return getMainMenuResponse(site, "I'm not sure how to help with that. Please choose an option from the menu or type a question directly.");
  } catch (error) {
    console.error('Message processing error:', error);
    return {
      text: getFallbackResponse(body, site),
      buttons: [
        { label: "⬅️ Back", value: "0" },
        { label: "🏠 Main Menu", value: "menu" }
      ]
    };
  }
}

/**
 * Helper to build standard main menu response payload
 */
function getMainMenuResponse(site = 'testpan', customPreamble = null) {
  let headerText = customPreamble;
  switch (site) {
    case 'bmtc':
      headerText = headerText || "Welcome to BookMyTestCenter! 🏢 How can I help you book or locate an exam test center today?";
      break;
    case 'manpower':
      headerText = headerText || "Welcome to ManpowerX! 💼 Looking for workforce solutions or job opportunities? Let's get started.";
      break;
    case 'testpan':
    default:
      headerText = headerText || "Welcome to Testpan India! 🚀 How can we assist you today?";
      break;
  }

  return {
    text: headerText,
    buttons: [
      { label: "💻 Our Services", value: "1" },
      { label: "🤝 Partner with us", value: "2" },
      { label: "ℹ️ About Testpan India", value: "3" },
      { label: "⁉️ FAQ", value: "4" },
      { label: "📲 Customer Support", value: "5" }
    ]
  };
}

function getPortalResponse(query) {
  const intent = getPortalIntent(query);
  if (intent === 'centre-registration') {
    return {
      text: 'To register or partner your test centre with us, please visit https://center.bookmytestcenter.com.',
      buttons: [{ label: '🏠 Main Menu', value: 'menu' }]
    };
  }

  if (intent === 'client-booking') {
    return {
      text: 'To book test centres or host an exam as a client, please visit https://client.bookmytestcenter.com.',
      buttons: [{ label: '🏠 Main Menu', value: 'menu' }]
    };
  }

  return null;
}

/**
 * Helper to update session and then return the response object.
 * Prevents the code from falling through to other logic blocks.
 * @param {string} sessionId
 * @param {object} sessionData
 * @param {object} response
 */
function updateSessionAndReturn(sessionId, sessionData, response) {
  updateSession(sessionId, sessionData);
  return response;
}
/**
 * Clear session data when user disconnects
 * @param {string} sessionId - Unique identifier for the session/socket
 */
export function clearSession(sessionId) {
  sessions.delete(sessionId);
  console.log(`Session cleared: ${sessionId}`);
}