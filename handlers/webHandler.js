import {
  processAIQuery,
  shouldUseAI,
  isAIAvailable,
  getFallbackResponse,
} from "./aiHandler.js";
import { getSiteProfile, normalizeSite } from "../config/siteConfig.js";
import { getPortalIntent, normalizeUserQuery } from './intentMatcher.js';

const sessions = new Map();

/**
 * Simulates the "typing" effect over a complete, already-fetched AI
 * response by emitting the same `bot_chunk` events the client already
 * listens for, spaced out over time.
 */
function streamTextToSocket(socket, text, { delayMs = 18 } = {}) {
  return new Promise((resolve) => {
    const words = (text || '').match(/\S+\s*/g);

    if (!words || words.length === 0) {
      resolve(0);
      return;
    }

    let i = 0;

    const timer = setInterval(() => {
      if (i >= words.length) {
        clearInterval(timer);
        resolve(words.length);
        return;
      }

      socket.emit('bot_chunk', { chunk: words[i] });
      i++;
    }, delayMs);
  });
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      state: 'GREETING',
      lead: {}
    });
  }

  return sessions.get(sessionId);
}

export function updateSession(sessionId, data) {
  const session = getSession(sessionId);

  sessions.set(sessionId, {
    ...session,
    ...data
  });

  return getSession(sessionId);
}

function validateIndianPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;

  const strippedPhone = phone.replace(/^(?:\+91|91|0)/, '');

  if (/^[6-9]\d{9}$/.test(strippedPhone)) {
    return strippedPhone;
  }

  return null;
}

export async function processMessage(
  socket,
  messageBody,
  currentSite = "testpan"
) {
  const body = (messageBody || "").trim();
  const site = normalizeSite(currentSite);
  const session = getSession(socket.id);
  const siteProfile = getSiteProfile(site);

  if (!body) {
    return {
      text: "Please send a message.",
      buttons: [
        {
          label: "🏠 Main Menu",
          value: "menu"
        }
      ]
    };
  }

  try {
    const lowerBody = normalizeUserQuery(body);

    const greetingPattern =
      /^(hi|hello|hey|hii|hiii|helo|hola|namaste|pranam|good morning|good afternoon|good evening)$/i;

    if (greetingPattern.test(lowerBody)) {
      updateSession(socket.id, {
        state: 'GREETING'
      });

      return getMainMenuResponse(
        site,
        "Hello there! How can I help you today?"
      );
    }

    if (lowerBody === "menu" || lowerBody === "0") {
      updateSession(socket.id, {
        state: 'GREETING'
      });

      return getMainMenuResponse(site);
    }

    /*
     * Simple portal queries are handled immediately.
     * More complex questions are allowed to continue to the AI/RAG flow.
     */
    if (isSimplePortalQuery(lowerBody)) {
      const portalResponse = getPortalResponse(lowerBody);

      if (portalResponse) {
        return portalResponse;
      }
    }

    if (lowerBody === "1") {
      const response = {
        text:
          "💻 **Our Services**\n\n" +
          "We specialize in a range of examination solutions:\n\n" +
          "*   **Computer-Based Testing (CBT)**: End-to-end infrastructure for online exams.\n" +
          "*   **Exam Center Management**: Comprehensive management of test venues.\n" +
          "*   **ManpowerX**: Our dedicated workforce and staffing solution.\n" +
          "*   **BookMyTestCenter**: A one-stop portal for booking exam centers.",

        buttons: [
          {
            label: "⬅️ Back",
            value: "0"
          },
          {
            label: "🏠 Main Menu",
            value: "menu"
          }
        ]
      };

      return updateSessionAndReturn(
        socket.id,
        {
          state: 'LEAD_PROMPT',
          purpose: 'Our Services'
        },
        response
      );
    }

    if (lowerBody === "2") {
      const response = {
        text:
          "🤝 **Partner With Us**\n\n" +
          "We are always looking to partner with institutions, colleges, and testing centers nationwide. " +
          "Reach out to our team to learn how you can set up a certified exam venue with our full IT and security support.",

        buttons: [
          {
            label: "⬅️ Back",
            value: "0"
          },
          {
            label: "🏠 Main Menu",
            value: "menu"
          }
        ]
      };

      return updateSessionAndReturn(
        socket.id,
        {
          state: 'LEAD_PROMPT',
          purpose: 'Partner with us'
        },
        response
      );
    }

    if (lowerBody === "3") {
      let responseText;
      let purpose;

      switch (site) {
        case 'manpower':
          responseText =
            "ℹ️ **About ManpowerX**\n\n" +
            "ManpowerX is our specialized staffing service. We provide skilled and verified personnel—including invigilators, technical support, and administrative staff—to ensure examinations are conducted smoothly and securely across India.";
          purpose = 'About ManpowerX';
          break;

        case 'bmtc':
          responseText =
            "ℹ️ **About BookMyTestCenter**\n\n" +
            "BookMyTestCenter (BMTC) is our one-stop digital platform for booking and managing examination centers. It streamlines finding, verifying, and securing test centers for assessment bodies nationwide.";
          purpose = 'About BookMyTestCenter';
          break;

        case 'testpan':
        default:
          responseText =
            "ℹ️ **About Testpan India**\n\n" +
            "Founded in 2016 by our CEO, **Mr. Rajesh Setia**, Testpan India is a premier provider of examination center management, IT infrastructure, and computer-based testing (CBT) solutions across India.";
          purpose = 'About Testpan India';
          break;
      }

      return updateSessionAndReturn(
        socket.id,
        {
          state: 'LEAD_PROMPT',
          purpose: purpose
        },
        {
          text: responseText,
          buttons: [
            { label: "⬅️ Back", value: "0" },
            { label: "🏠 Main Menu", value: "menu" }
          ]
        }
      );
    }

    if (lowerBody === "4") {
      const response = {
        text:
          "⁉️ **Frequently Asked Questions**\n\n" +
          "*   **How do I book a test center for an exam?**\n" +
          "    You can visit our client portal at https://clients.bookmytestcenter.com\n\n" +
          "*   **How do I register my test center?**\n" +
          "    To partner with us, please register at https://center.bookmytestcenter.com\n\n" +
          "*   **What is ManpowerX?**\n" +
          "    ManpowerX is our dedicated staffing solution for invigilators and exam staff.\n\n" +
          "Feel free to type your own question below to ask our AI assistant!",

        buttons: [
          {
            label: "⬅️ Back",
            value: "0"
          },
          {
            label: "🏠 Main Menu",
            value: "menu"
          }
        ]
      };

      return updateSessionAndReturn(
        socket.id,
        {
          state: 'GREETING'
        },
        response
      );
    }

    if (lowerBody === "5") {
      return {
        text:
          "📲 **Customer Support**\n\n" +
          "You can reach our support team directly by:\n\n" +
          "*   **Phone**: +91 98101 47334\n" +
          "*   **Email**: info@testpanindia.com",

        buttons: [
          {
            label: "⬅️ Back",
            value: "0"
          },
          {
            label: "🏠 Main Menu",
            value: "menu"
          }
        ]
      };
    }

    /*
     * Lead capture flow
     */
    if (session.state === 'LEAD_PROMPT') {
      if (validateIndianPhoneNumber(body)) {
        updateSession(socket.id, { state: 'GREETING', lead: { ...session.lead, phone: body } });

        const leadName = session.lead.name || 'there';

        return {
          text:
            `Thanks! Our team will reach out to you shortly. ` +
            `Is there anything else I can help with, ${leadName}?`,

          buttons: getMainMenuResponse(site).buttons,

          leadData: {
            ...session.lead,
            phone: body,
            purposeOfVisit: session.purpose,
            websiteVisited: siteProfile.name
          }
        };
      } else if (shouldUseAI(body)) {
        // The user might ask a follow-up question instead of providing a name.
        // Let it fall through to the main AI handler.
      } else {
        const nameMatch = body.match(
          /(?:my\s+name\s+is|i'm|i\s+am)\s+([a-z\s]+)/i
        );

        const name = nameMatch
          ? nameMatch[1].trim()
          : body;

        const sanitizedName = name.slice(0, 50);

        updateSession(socket.id, {
          state: 'LEAD_PROMPT_PHONE',
          lead: {
            name: sanitizedName
          }
        });

        return {
          text:
            `Got it, ${sanitizedName}! And what's the best phone number to reach you at?`,

          buttons: [
            {
              label: "🏠 Main Menu",
              value: "menu"
            }
          ]
        };
      }
    }

    /*
     * AI / RAG FLOW
     */
    if (shouldUseAI(body)) {
      // Inform the user that the AI is processing, as it might take a moment.
      socket.emit('bot_typing');
      if (isAIAvailable()) {
        const aiResult = await processAIQuery(
          body,
          site,
          session
        );

        /*
         * Real Gemini response:
         * stream it to the frontend so the existing typing effect remains.
         */
        if (
          aiResult.success &&
          aiResult.source === 'ai' &&
          typeof aiResult.text === 'string'
        ) {
          const requestStart =
            aiResult.timing?.requestStart ?? Date.now();

          socket.emit('bot_message', {
            text: '',
            buttons: []
          });

          const chunkCount = await streamTextToSocket(
            socket,
            aiResult.text
          );

          if (chunkCount === 0) {
            console.log(
              `[AI TIMING] AI returned no text. Sending fallback.`
            );

            const fallbackChunk =
              "I'm sorry, I was unable to generate a response for that. " +
              "Please try rephrasing your question, or select an option from the menu.";

            socket.emit('bot_chunk', {
              chunk: fallbackChunk
            });
          }

          console.log(
            `[AI TIMING] Response fully sent: ${chunkCount} chunks, ` +
            `${Date.now() - requestStart}ms end-to-end`
          );

          const currentSession =
            updateSession(socket.id, {});

          if (
            currentSession.state !== 'LEAD_CAPTURE_PHONE' &&
            currentSession.state !== 'LEAD_PROMPT'
          ) {
            const leadPrompt = {
              chunk:
                `\n\nI hope that was helpful! To provide you with more detailed information, ` +
                `could you please tell me your name?`
            };

            socket.emit('bot_chunk', leadPrompt);

            updateSession(socket.id, {
              state: 'LEAD_PROMPT',
              purpose: `AI Query: "${body}"`
            });
          }

          return null;
        }

        /*
         * Fast-path / fallback responses from aiHandler.js already contain
         * their own complete text, so return them directly.
         *
         * IMPORTANT:
         * This is also what allows Gemini failures to show a useful
         * fallback instead of falling through to another generic response.
         */
        else if (aiResult.success) {
          return {
            text: aiResult.text || aiResult.response,
            buttons: aiResult.buttons || [
              {
                label: "⬅️ Back",
                value: "0"
              },
              {
                label: "🏠 Main Menu",
                value: "menu"
              }
            ]
          };
        }
      }

      /*
       * Final fallback if AI is unavailable.
       */
      return {
        text: getFallbackResponse(body, site),

        buttons: [
          {
            label: "⬅️ Back",
            value: "0"
          },
          {
            label: "🏠 Main Menu",
            value: "menu"
          }
        ]
      };
    }

    /*
     * Phone capture state.
     */
    if (session.state === 'LEAD_PROMPT_PHONE') {
      const validatedPhone =
        validateIndianPhoneNumber(body);

      if (!validatedPhone) {
        return {
          text:
            "Please enter a valid 10-digit Indian mobile number " +
            "(e.g., 9876543210) so our team can reach out to you.",

          buttons: [
            {
              label: "Skip",
              value: "menu"
            },
            {
              label: "🏠 Main Menu",
              value: "menu"
            }
          ]
        };
      }

      const finalSession = updateSession(
        socket.id,
        {
          state: 'GREETING',
          lead: {
            ...session.lead,
            phone: body
          }
        }
      );

      return {
        text:
          `Thanks, ${finalSession.lead.name}! ` +
          `Our team will reach out to you shortly. ` +
          `Is there anything else I can help with?`,

        buttons: getMainMenuResponse(site).buttons,

        leadData: {
          ...finalSession.lead,
          purposeOfVisit: finalSession.purpose,
          websiteVisited: siteProfile.name
        }
      };
    }

    const empatheticPreamble =
      "My apologies, I didn't quite understand that. " +
      "I'm still in training and learning new things every day! " +
      "Could you perhaps rephrase your question? Or, you can select one of the options below to get started.";

    return getMainMenuResponse(
      site,
      empatheticPreamble
    );

  } catch (error) {
    console.error(
      'Message processing error:',
      error
    );

    return {
      text:
        "It seems I've encountered a technical glitch. " +
        "I've logged the issue for my human colleagues to review. " +
        "In the meantime, you can try asking your question again or select an option from the menu.",

      buttons: [
        {
          label: "⬅️ Back",
          value: "0"
        },
        {
          label: "🏠 Main Menu",
          value: "menu"
        }
      ]
    };
  }
}

function getMainMenuResponse(
  site = 'testpan',
  customPreamble = null
) {
  let headerText = customPreamble;

  switch (site) {
    case 'bmtc':
      headerText =
        headerText ||
        "Welcome to BookMyTestCenter! 🏢 How can I help you book or locate an exam test center today?";
      break;

    case 'manpower':
      headerText =
        headerText ||
        "Welcome to ManpowerX! 💼 Looking for workforce solutions or job opportunities? Let's get started.";
      break;

    case 'testpan':
    default:
      headerText =
        headerText ||
        "Welcome to Testpan India! 🚀 How can we assist you today?";
      break;
  }

  const aboutButtonLabel = {
    testpan: "ℹ️ About Testpan India",
    bmtc: "ℹ️ About BookMyTestCenter",
    manpower: "ℹ️ About ManpowerX",
  }[site] || "ℹ️ About Us";

  return {
    text: headerText,

    buttons: [
      {
        label: "💻 Our Services",
        value: "1",
      },
      {
        label: "🤝 Partner with us",
        value: "2",
      },
      {
        label: aboutButtonLabel,
        value: "3",
      },
      {
        label: "⁉️ FAQ",
        value: "4",
      },
      {
        label: "📲 Customer Support",
        value: "5",
      },
    ],
  };
}

const PORTAL_COMPLEXITY_MARKERS =
  /\b(how|what|why|large|dates?|seats?|available|availability|cost|price|cities|city|company|started|check|before|confirm|verify|download|app)\b/i;

function isSimplePortalQuery(query) {
  const wordCount =
    query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length;

  return (
    wordCount <= 6 &&
    !PORTAL_COMPLEXITY_MARKERS.test(query)
  );
}

function getPortalResponse(query) {
  const intent = getPortalIntent(query);

  if (intent === 'centre-registration') {
    return {
      text:
        'To register or partner your test centre with us, please visit https://center.bookmytestcenter.com.',

      buttons: [
        {
          label: '🏠 Main Menu',
          value: 'menu'
        }
      ]
    };
  }

  if (intent === 'client-booking') {
    return {
      text:
        'To book test centres or host an exam as a client, please visit https://clients.bookmytestcenter.com.',

      buttons: [
        {
          label: '🏠 Main Menu',
          value: 'menu'
        }
      ]
    };
  }

  return null;
}

function updateSessionAndReturn(
  sessionId,
  sessionData,
  response
) {
  updateSession(
    sessionId,
    sessionData
  );

  return response;
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);

  console.log(
    `Session cleared: ${sessionId}`
  );
}