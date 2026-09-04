/**
 * Testpan India Chatbot Widget
 * Standalone client script that dynamically injects a floating chat widget
 */

(function() {
  const SITE_ALIASES = {
    testpan: 'testpan', testpanindia: 'testpan',
    bmtc: 'bmtc', bookmytestcenter: 'bmtc', bookmytestcentre: 'bmtc',
    manpower: 'manpower', manpowerx: 'manpower', mpx: 'manpower'
  };
  const SITE_PROFILES = {
    testpan: { key: 'testpan', name: 'Testpan India', logo: '/logo.png', headerLogoBackground: 'transparent' },
    bmtc: { key: 'bmtc', name: 'BookMyTestCenter', logo: '/logo2.png', headerLogoBackground: 'white' },
    manpower: { key: 'manpower', name: 'ManpowerX', logo: '/logo3.png', headerLogoBackground: 'white' }
  };

  function resolveSite() {
    // Read the site parameter directly from the config object set by the loader.
    const suppliedSite = (window.TESTPAN_CHAT_CONFIG && window.TESTPAN_CHAT_CONFIG.site)
      ? window.TESTPAN_CHAT_CONFIG.site
      : window.location.hostname;

    const normalized = String(suppliedSite).toLowerCase().replace(/[^a-z0-9]/g, '');

    const key = SITE_ALIASES[normalized]
      || (window.location.hostname.includes('manpowerx') ? 'manpower' : window.location.hostname.includes('bookmytestcenter') ? 'bmtc' : 'testpan');
    return SITE_PROFILES[key];
  }

  const ACTIVE_SITE = resolveSite();

  // Widget configuration - Testpan brand colors
  const serverUrl = (window.TESTPAN_CHAT_CONFIG && window.TESTPAN_CHAT_CONFIG.serverUrl)
    ? window.TESTPAN_CHAT_CONFIG.serverUrl
    : window.location.origin;
  const CONFIG = {
    serverUrl: serverUrl,
    primaryColor: '#0052A3',      // Testpan corporate blue from logo
    accentColor: '#FF9500',        // Testpan orange accent from logo
    widgetTitle: `${ACTIVE_SITE.name} Support`,
    widgetPosition: 'bottom-right',
    autoOpen: false,
    welcomeMessage: 'Hello! How can I help you today?'
  };

  // Widget state
  let socket = null;
  let isWidgetOpen = false;
  let messageHistory = [];

  // Keep display labels separate from the stable commands understood by the server.
  // This also lets older server payloads that omit `value` continue to work.
  const QUICK_REPLY_COMMANDS = {
    '💻 Our Services': '1',
    '🤝 Partner with us': '2',
    'ℹ️ About Testpan India': '3',
    '⁉️ FAQ': '4',
    '📲 Customer Support': '5',
    '⬅️ Back': '0',
    '🏠 Main Menu': 'menu'
  };

  function init() {
    // Check if running inside an iframe
    const isIframe = window.self !== window.top;

    if (isIframe) {
      createWidget(true); // Force iframe mode
    } else {
      createWidget(false);
      if (CONFIG.autoOpen) setTimeout(toggleWidget, 1000);
    }
  }

  // Create widget HTML structure
  function createWidget(isIframe = false) {
    // Create main container
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'testpan-chat-widget';
    widgetContainer.className = 'testpan-widget-container';

    // Only create the launcher if not in an iframe
    if (!isIframe) {
      const launcher = document.createElement('button');
      launcher.id = 'testpan-chat-launcher';
      launcher.className = 'testpan-launcher';
      launcher.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="white"/>
        </svg>
      `;
      launcher.addEventListener('click', toggleWidget);
      widgetContainer.appendChild(launcher);
    }

    // Create chat window
    const chatWindow = document.createElement('div');
    chatWindow.id = 'testpan-chat-window';
    chatWindow.className = 'testpan-chat-window';

    // Create header
    const header = document.createElement('div');
    header.className = 'testpan-chat-header';
    header.innerHTML = `
      <div class="testpan-header-content">
        <div class="testpan-logo" data-logo-background="${ACTIVE_SITE.headerLogoBackground}">
          <!-- Try to load image logo first, fallback to SVG -->
          <img id="testpan-logo-img" src="${ACTIVE_SITE.logo}" alt="${ACTIVE_SITE.name} Logo" style="display: none;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" onload="this.nextElementSibling.style.display='none'; this.style.display='block';" />
          <svg id="testpan-logo-svg" style="display: none;" width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="16" fill="#0052A3"/>
            <path d="M16 8C11.58 8 8 11.58 8 16C8 20.42 11.58 24 16 24C20.42 24 24 20.42 24 16C24 11.58 20.42 8 16 8ZM17 19H15V17H17V19ZM17 15H15V11H17V15Z" fill="white"/>
          </svg>
        </div>
        <div class="testpan-header-info">
          <h3>${ACTIVE_SITE.name}</h3>
          <span class="testpan-status-indicator online"></span>
          <span class="testpan-status-text">Online</span>
        </div>
      </div>
      <button class="testpan-minimize-btn" id="testpan-minimize-btn">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 5L5 15M5 5L15 15" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    // Create messages container
    const messagesContainer = document.createElement('div');
    messagesContainer.id = 'testpan-messages-container';
    messagesContainer.className = 'testpan-messages-container';

    // Create input area
    const inputArea = document.createElement('div');
    inputArea.className = 'testpan-input-area';
    inputArea.innerHTML = `
      <input type="text" id="testpan-message-input" class="testpan-message-input" placeholder="Type your message..." />
      <button id="testpan-send-btn" class="testpan-send-btn">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 2L2 10L18 18L18 2Z" fill="white"/>
        </svg>
      </button>
    `;

    // Assemble chat window
    chatWindow.appendChild(header);
    chatWindow.appendChild(messagesContainer);
    chatWindow.appendChild(inputArea);

    // If in an iframe, open the chat window immediately and apply styles
    if (isIframe) {
      chatWindow.classList.add('open');
      chatWindow.style.width = '100%';
      chatWindow.style.height = '100%';
      chatWindow.style.borderRadius = '0';
      chatWindow.style.right = '0';
      chatWindow.style.bottom = '0';
      chatWindow.style.position = 'absolute'; // Use absolute to fill container
      
      initializeSocket();
      
      // The main container should also fill the body
      widgetContainer.style.width = '100%';
      widgetContainer.style.height = '100%';
    }

    // Set the global state after creation
    isWidgetOpen = isIframe;

    widgetContainer.appendChild(chatWindow);

    // Add to page
    document.body.appendChild(widgetContainer);

    // Setup event listeners immediately after DOM insertion
    requestAnimationFrame(setupEventListeners);
  }

  // Setup event listeners
  function setupEventListeners() {
    const input = document.getElementById('testpan-message-input');
    const sendBtn = document.getElementById('testpan-send-btn');
    const minimizeBtn = document.getElementById('testpan-minimize-btn');

    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          sendMessage();
        }
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', sendMessage);
    }

    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', toggleWidget);
    }
  }

  // Toggle widget open/close
  function toggleWidget() {
    const chatWindow = document.getElementById('testpan-chat-window');
    const launcher = document.getElementById('testpan-chat-launcher');

    // Handle iframe case where launcher is null
    const isIframe = window.self !== window.top;
    if (isIframe && chatWindow) {
      // In an iframe, the minimize button should hide the parent iframe.
      // We send a message to the parent window to handle this.
      window.parent.postMessage('testpan-chat-close', '*');
    } else if (chatWindow && launcher) {
      isWidgetOpen = !isWidgetOpen;
      chatWindow.classList.toggle('open', isWidgetOpen);
      launcher.classList.toggle('hidden', isWidgetOpen);

      if (isWidgetOpen && !socket) {
        initializeSocket();
      }

      if (isWidgetOpen) {
        const input = document.getElementById('testpan-message-input');
        if (input) input.focus();
      }
    }
  }

  // Initialize Socket.io connection
  function initializeSocket() {
    try {
      if (typeof io === 'undefined') {
        console.error('Socket.io client not loaded');
        addSystemMessage('Chat service unavailable - Socket.io not loaded. Please refresh the page.');
        return;
      }

      console.log('Initializing Socket.io connection to:', CONFIG.serverUrl);
      
      socket = io(CONFIG.serverUrl, {
        query: { site: ACTIVE_SITE.key },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      socket.on('connect', () => {
        console.log('Connected to chat server');
        addSystemMessage(`Connected to ${ACTIVE_SITE.name} support`);
      });

      socket.on('bot_message', (data) => {
        removeTypingIndicator(); // Remove typing indicator
        addBotMessage(data.text, data.buttons, data.leadData, data.purpose);
        if (data.leadData) {
          socket.emit('save_user_lead', {
            ...data.leadData,
            website: window.location.hostname
          });
        }
      });

      socket.on('bot_typing', showTypingIndicator);

      socket.on('disconnect', () => {
        addSystemMessage('Disconnected from server');
        socket = null;
      });

      socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        addSystemMessage('Connection error. Retrying...');
      });

      socket.on('error', (error) => {
        console.error('Socket error:', error);
        addSystemMessage('Connection error: ' + error.message);
      });
    } catch (error) {
      console.error('Failed to initialize socket:', error);
      addSystemMessage('Failed to connect to chat server');
    }
  }

  // Send user message
  function sendMessage() {
    const input = document.getElementById('testpan-message-input');
    const message = input.value.trim();

    if (message) {
      sendUserMessage(message);
      input.value = '';
    }
  }

  function sendUserMessage(message, displayText = message) {
    if (!socket || !socket.connected) {
      addSystemMessage('Connecting to Testpan India support. Please try again in a moment.');
      return;
    }

    addUserMessage(displayText);
    showTypingIndicator(); // Render before the network round trip.
    socket.emit('user_message', { message, source: 'quick_reply' });
  }

  function sendQuickReply(button) {
    const command = String(button?.value ?? QUICK_REPLY_COMMANDS[button?.label] ?? button?.label ?? '').trim();
    if (!command) return;

    sendUserMessage(command, button.label || command);
  }

  // Add user message to chat
  function addUserMessage(text) {
    const container = document.getElementById('testpan-messages-container');
    if (!container) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'testpan-message testpan-user-message';
    messageDiv.textContent = text;

    container.appendChild(messageDiv);
    scrollToBottom();

    messageHistory.push({ type: 'user', text });
  }

  // Add bot message to chat with Markdown rendering support
  function addBotMessage(text, buttons = [], leadData = null, purpose = null) {
    const container = document.getElementById('testpan-messages-container');
    if (!container) return;

    // Remove typing indicator first
    removeTypingIndicator();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'testpan-message testpan-bot-message';

    // The PNG is transparent, so no opaque avatar wrapper is needed.
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'testpan-bot-avatar';
    avatarDiv.innerHTML = `
      <img class="testpan-avatar-img" src="${ACTIVE_SITE.logo}" alt="${ACTIVE_SITE.name} bot" onerror="this.style.display='none';" />
    `;
    messageDiv.appendChild(avatarDiv);

    // Add text div - display full message at once (Messenger style)
    const contentDiv = document.createElement('div');
    contentDiv.className = 'testpan-message-content';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'testpan-message-text';

    // Render Markdown using 'marked' library if available
    if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
      try {
        textDiv.innerHTML = window.marked.parse(text);
      } catch (e) {
        // Fallback to plain text with line breaks if markdown fails
        textDiv.innerHTML = text.replace(/\n/g, '<br>');
      }
    } else {
      // Fallback if marked.js not loaded
      textDiv.innerHTML = text.replace(/\n/g, '<br>');
    }

    contentDiv.appendChild(textDiv);

    // Add quick reply action buttons if present
    if (buttons && buttons.length > 0) {
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'testpan-message-buttons';

      buttons.forEach(button => {
        const buttonEl = document.createElement('button');
        buttonEl.className = 'testpan-quick-reply-btn';
        buttonEl.textContent = button.label;
        buttonEl.type = 'button';
        buttonEl.addEventListener('click', () => {
          buttonEl.disabled = true;
          sendQuickReply(button);
        }, { once: true });
        buttonsDiv.appendChild(buttonEl);
      });

      contentDiv.appendChild(buttonsDiv);
    }

    messageDiv.appendChild(contentDiv);
    container.appendChild(messageDiv);
    
    // Scroll message into view at the top
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

    messageHistory.push({ type: 'bot', text, buttons });
  }

  /**
   * Add typing indicator (animated dots) to show bot is responding
   */
  function showTypingIndicator() {
    const container = document.getElementById('testpan-messages-container');
    if (!container) return;

    // The client renders this optimistically and the server confirms it; keep one indicator.
    removeTypingIndicator();

    const typingDiv = document.createElement('div');
    typingDiv.id = 'testpan-typing-indicator';
    typingDiv.className = 'testpan-message testpan-bot-message testpan-typing-indicator';
    typingDiv.innerHTML = `
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span class="typing-text">Bot is typing</span>
    `;
    
    container.appendChild(typingDiv);
    
    // Scroll into view
    typingDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    return typingDiv;
  }

  /**
   * Remove typing indicator
   */
  function removeTypingIndicator() {
    const typingDiv = document.getElementById('testpan-typing-indicator');
    if (typingDiv) {
      typingDiv.remove();
    }
  }

  // Add system message
  function addSystemMessage(text) {
    const container = document.getElementById('testpan-messages-container');
    if (!container) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'testpan-message testpan-system-message';
    messageDiv.textContent = text;

    container.appendChild(messageDiv);
    scrollToBottom();
  }

  // Scroll to bottom of messages
  function scrollToBottom() {
    const container = document.getElementById('testpan-messages-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // Get input element
  function getInput() {
    return document.getElementById('testpan-message-input');
  }

  // Initialize widget when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose toggle function globally
  window.toggleTestpanWidget = toggleWidget;
  
  // Expose input getter for reference
  window.getTestpanInput = getInput;
})();