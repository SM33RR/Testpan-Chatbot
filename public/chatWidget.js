/**
 * Testpan India Chatbot Widget
 * Standalone client script that dynamically injects a floating chat widget
 */

(function() {

  const SITE_ALIASES = {
    testpan: 'testpan',
    testpanindia: 'testpan',

    bmtc: 'bmtc',
    bookmytestcenter: 'bmtc',
    bookmytestcentre: 'bmtc',

    manpower: 'manpower',
    manpowerx: 'manpower',
    mpx: 'manpower'
  };


  const SITE_PROFILES = {

    testpan: {
      key: 'testpan',
      name: 'Testpan India',
      logo: '/logo.png',
      headerLogoBackground: 'transparent'
    },

    bmtc: {
      key: 'bmtc',
      name: 'BookMyTestCenter',
      logo: '/logo2.png',
      headerLogoBackground: 'white'
    },

    manpower: {
      key: 'manpower',
      name: 'ManpowerX',
      logo: '/logo3.png',
      headerLogoBackground: 'white'
    }

  };


  function resolveSite() {

    // Read the site parameter directly from the config object set by the loader.
    const suppliedSite =
      (window.TESTPAN_CHAT_CONFIG &&
       window.TESTPAN_CHAT_CONFIG.site)
        ? window.TESTPAN_CHAT_CONFIG.site
        : window.location.hostname;


    const normalized =
      String(suppliedSite)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');


    const key =
      SITE_ALIASES[normalized] ||

      (
        window.location.hostname.includes('manpowerx')
          ? 'manpower'

          : window.location.hostname.includes('bookmytestcenter')
            ? 'bmtc'

            : 'testpan'
      );


    return SITE_PROFILES[key];

  }


  const ACTIVE_SITE = resolveSite();


  const serverUrl =
    (window.TESTPAN_CHAT_CONFIG &&
     window.TESTPAN_CHAT_CONFIG.serverUrl)
      ? window.TESTPAN_CHAT_CONFIG.serverUrl
      : window.location.origin;


  const CONFIG = {

    serverUrl: serverUrl,

    primaryColor: '#0052A3',

    accentColor: '#FF9500',

    widgetTitle: `${ACTIVE_SITE.name} Support`,

    widgetPosition: 'bottom-right',

    autoOpen: false,

    welcomeMessage: 'Hello! How can I help you today?'

  };


  // Widget state
  let socket = null;

  let isWidgetOpen = false;

  let messageHistory = [];


  // Keep display labels separate from stable commands understood by the server.
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

    // Check if running inside an iframe.
    const isIframe = window.self !== window.top;


    if (isIframe) {

      // Open immediately when running inside iframe.
      createWidget(true);

    } else {

      // Normal floating widget mode.
      createWidget(false);

      if (CONFIG.autoOpen) {
        setTimeout(toggleWidget, 1000);
      }

    }

  }


  function createWidget(isIframe = false) {

    // Create main container.
    const widgetContainer = document.createElement('div');

    widgetContainer.id = 'testpan-chat-widget';

    widgetContainer.className = 'testpan-widget-container';


    // Only create launcher outside iframe.
    if (!isIframe) {

      const launcher = document.createElement('button');

      launcher.id = 'testpan-chat-launcher';

      launcher.className = 'testpan-launcher';


      launcher.innerHTML = `
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"
            fill="white"
          />
        </svg>
      `;


      launcher.addEventListener(
        'click',
        toggleWidget
      );


      widgetContainer.appendChild(launcher);

    }


    // Create chat window.
    const chatWindow = document.createElement('div');

    chatWindow.id = 'testpan-chat-window';

    chatWindow.className = 'testpan-chat-window';


    // Create header.
    const header = document.createElement('div');

    header.className = 'testpan-chat-header';


    header.innerHTML = `

      <div class="testpan-header-content">

        <div
          class="testpan-logo"
          data-logo-background="${ACTIVE_SITE.headerLogoBackground}"
        >

          <img
            id="testpan-logo-img"
            src="${ACTIVE_SITE.logo}"
            alt="${ACTIVE_SITE.name} Logo"
            style="display: none;"
            onerror="
              this.style.display='none';
              this.nextElementSibling.style.display='block';
            "
            onload="
              this.nextElementSibling.style.display='none';
              this.style.display='block';
            "
          />

          <svg
            id="testpan-logo-svg"
            style="display: none;"
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >

            <circle
              cx="16"
              cy="16"
              r="16"
              fill="#0052A3"
            />

            <path
              d="M16 8C11.58 8 8 11.58 8 16C8 20.42 11.58 24 16 24C20.42 24 24 20.42 24 16C24 11.58 20.42 8 16 8ZM17 19H15V17H17V19ZM17 15H15V11H17V15Z"
              fill="white"
            />

          </svg>

        </div>


        <div class="testpan-header-info">

          <h3>${ACTIVE_SITE.name}</h3>

          <span
            class="testpan-status-indicator online"
          ></span>

          <span
            class="testpan-status-text"
          >
            Online
          </span>

        </div>

      </div>


      <button
        class="testpan-minimize-btn"
        id="testpan-minimize-btn"
      >

        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >

          <path
            d="M15 5L5 15M5 5L15 15"
            stroke="white"
            stroke-width="2"
            stroke-linecap="round"
          />

        </svg>

      </button>

    `;


    // Messages container.
    const messagesContainer =
      document.createElement('div');

    messagesContainer.id =
      'testpan-messages-container';

    messagesContainer.className =
      'testpan-messages-container';


    // Input area.
    const inputArea =
      document.createElement('div');

    inputArea.className =
      'testpan-input-area';


    inputArea.innerHTML = `

      <input
        type="text"
        id="testpan-message-input"
        class="testpan-message-input"
        placeholder="Type your message..."
      />

      <button
        id="testpan-send-btn"
        class="testpan-send-btn"
      >

        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >

          <path
            d="M18 2L2 10L18 18L18 2Z"
            fill="white"
          />

        </svg>

      </button>

    `;


    // Assemble chat window.
    chatWindow.appendChild(header);

    chatWindow.appendChild(messagesContainer);

    chatWindow.appendChild(inputArea);


    // Iframe mode.
    if (isIframe) {

      chatWindow.classList.add('open');

      chatWindow.style.width = '100%';

      chatWindow.style.height = '100%';

      chatWindow.style.borderRadius = '0';

      chatWindow.style.right = '0';

      chatWindow.style.bottom = '0';

      chatWindow.style.position = 'absolute';


      widgetContainer.style.width = '100%';

      widgetContainer.style.height = '100%';

      // style.css sets bottom/right insets on .testpan-widget-container for
      // the floating-launcher mode. In iframe mode the container must fill
      // the iframe exactly, or chatWindow (positioned absolute relative to
      // this container) ends up shifted and clipped at the edges.
      widgetContainer.style.top = '0';

      widgetContainer.style.left = '0';

      widgetContainer.style.bottom = '0';

      widgetContainer.style.right = '0';

    }


    // Set global state.
    isWidgetOpen = isIframe;


    widgetContainer.appendChild(chatWindow);


    // Add to page.
    document.body.appendChild(widgetContainer);


    // Setup event listeners.
    requestAnimationFrame(
      setupEventListeners
    );


    /*
     * Initialize socket after the widget has been added
     * to the DOM.
     */
    if (isIframe) {
      initializeSocket();
    }

  }


  function setupEventListeners() {

    const input =
      document.getElementById(
        'testpan-message-input'
      );


    const sendBtn =
      document.getElementById(
        'testpan-send-btn'
      );


    const minimizeBtn =
      document.getElementById(
        'testpan-minimize-btn'
      );


    if (input) {

      input.addEventListener(
        'keypress',
        (e) => {

          if (e.key === 'Enter') {
            sendMessage();
          }

        }
      );

    }


    if (sendBtn) {

      sendBtn.addEventListener(
        'click',
        sendMessage
      );

    }


    if (minimizeBtn) {

      minimizeBtn.addEventListener(
        'click',
        toggleWidget
      );

    }

  }


  function toggleWidget() {

    const chatWindow =
      document.getElementById(
        'testpan-chat-window'
      );


    const launcher =
      document.getElementById(
        'testpan-chat-launcher'
      );


    const isIframe =
      window.self !== window.top;


    // Iframe mode.
    if (isIframe && chatWindow) {

      window.parent.postMessage(
        'testpan-chat-close',
        '*'
      );

      return;

    }


    // Normal widget mode.
    if (chatWindow && launcher) {

      isWidgetOpen =
        !isWidgetOpen;


      chatWindow.classList.toggle(
        'open',
        isWidgetOpen
      );


      launcher.classList.toggle(
        'hidden',
        isWidgetOpen
      );


      if (
        isWidgetOpen &&
        !socket
      ) {

        initializeSocket();

      }


      if (isWidgetOpen) {

        const input =
          document.getElementById(
            'testpan-message-input'
          );


        if (input) {
          input.focus();
        }

      }

    }

  }


  function initializeSocket() {

    try {

      if (typeof io === 'undefined') {

        console.error(
          'Socket.io client not loaded'
        );


        addSystemMessage(
          'Chat service unavailable - Socket.io not loaded. Please refresh the page.'
        );

        return;

      }


      console.log(
        'Initializing Socket.io connection to:',
        CONFIG.serverUrl
      );


      console.log(
        'Active site:',
        ACTIVE_SITE.key
      );


      socket = io(
        CONFIG.serverUrl,
        {

          query: {
            site: ACTIVE_SITE.key
          },

          transports: [
            'websocket',
            'polling'
          ],

          reconnection: true,

          reconnectionAttempts: 5,

          reconnectionDelay: 1000

        }
      );


      socket.on(
        'connect',
        () => {

          console.log(
            'Connected to chat server'
          );


          addSystemMessage(
            `Connected to ${ACTIVE_SITE.name} support`
          );

        }
      );


      socket.on(
        'bot_message',
        (data) => {

          removeTypingIndicator();


          addBotMessage(
            data.text,
            data.buttons,
            data.leadData,
            data.purpose
          );


          if (data.leadData) {

            socket.emit(
              'save_user_lead',
              {
                ...data.leadData,
                website: window.location.hostname
              }
            );

          }

        }
      );


      // Streamed AI response chunks.
      socket.on(
        'bot_chunk',
        (data) => {

          if (
            !data ||
            !data.chunk
          ) {
            return;
          }


          const container =
            document.getElementById(
              'testpan-messages-container'
            );


          if (!container) {
            return;
          }


          const messages =
            container.querySelectorAll(
              '.testpan-bot-message'
            );


          const lastMessage =
            messages.length > 0
              ? messages[messages.length - 1]
              : null;


          const lastMessageText =
            lastMessage
              ? lastMessage.querySelector(
                  '.testpan-message-text'
                )
              : null;


          if (
            !lastMessage ||
            !lastMessageText
          ) {
            return;
          }


          const updatedText =
            (lastMessage.dataset.rawText || '') +
            data.chunk;


          lastMessage.dataset.rawText =
            updatedText;


          if (
            typeof window.marked !== 'undefined' &&
            typeof window.marked.parse === 'function'
          ) {

            try {

              lastMessageText.innerHTML =
                window.marked.parse(
                  updatedText
                );

            } catch (e) {

              lastMessageText.innerHTML =
                updatedText.replace(
                  /\n/g,
                  '<br>'
                );

            }

          } else {

            lastMessageText.innerHTML =
              updatedText.replace(
                /\n/g,
                '<br>'
              );

          }


          scrollToBottom();

        }
      );


      socket.on(
        'bot_typing',
        showTypingIndicator
      );


      socket.on(
        'disconnect',
        () => {

          addSystemMessage(
            'Disconnected from server'
          );

          socket = null;

        }
      );


      socket.on(
        'connect_error',
        (error) => {

          console.error(
            'Connection error:',
            error
          );


          addSystemMessage(
            'Connection error. Retrying...'
          );

        }
      );


      socket.on(
        'error',
        (error) => {

          console.error(
            'Socket error:',
            error
          );


          addSystemMessage(
            'Connection error: ' +
            error.message
          );

        }
      );

    } catch (error) {

      console.error(
        'Failed to initialize socket:',
        error
      );


      addSystemMessage(
        'Failed to connect to chat server'
      );

    }

  }


  function sendMessage() {

    const input =
      document.getElementById(
        'testpan-message-input'
      );


    if (!input) {
      return;
    }


    const message =
      input.value.trim();


    if (message) {

      sendUserMessage(message);

      input.value = '';

    }

  }


  function sendUserMessage(
    message,
    displayText = message
  ) {

    if (
      !socket ||
      !socket.connected
    ) {

      addSystemMessage(
        `Connecting to ${ACTIVE_SITE.name} support. Please try again in a moment.`
      );

      return;

    }


    addUserMessage(
      displayText
    );


    showTypingIndicator();


    socket.emit(
      'user_message',
      {
        message,
        source: 'quick_reply'
      }
    );

  }


  function sendQuickReply(button) {

    const command =
      String(
        button?.value ??
        QUICK_REPLY_COMMANDS[
          button?.label
        ] ??
        button?.label ??
        ''
      ).trim();


    if (!command) {
      return;
    }


    sendUserMessage(
      command,
      button.label || command
    );

  }


  function addUserMessage(text) {

    const container =
      document.getElementById(
        'testpan-messages-container'
      );


    if (!container) {
      return;
    }


    const messageDiv =
      document.createElement('div');


    messageDiv.className =
      'testpan-message testpan-user-message';


    messageDiv.textContent =
      text;


    container.appendChild(
      messageDiv
    );


    scrollToBottom();


    messageHistory.push({
      type: 'user',
      text
    });

  }


  function addBotMessage(
    text,
    buttons = [],
    leadData = null,
    purpose = null
  ) {

    const container =
      document.getElementById(
        'testpan-messages-container'
      );


    if (!container) {
      return;
    }


    removeTypingIndicator();


    const messageDiv =
      document.createElement('div');


    messageDiv.className =
      'testpan-message testpan-bot-message';


    messageDiv.dataset.rawText =
      text || '';


    const avatarDiv =
      document.createElement('div');


    avatarDiv.className =
      'testpan-bot-avatar';


    avatarDiv.innerHTML = `
      <img
        class="testpan-avatar-img"
        src="${ACTIVE_SITE.logo}"
        alt="${ACTIVE_SITE.name} bot"
        onerror="this.style.display='none';"
      />
    `;


    messageDiv.appendChild(
      avatarDiv
    );


    const contentDiv =
      document.createElement('div');


    contentDiv.className =
      'testpan-message-content';


    const textDiv =
      document.createElement('div');


    textDiv.className =
      'testpan-message-text';


    if (
      typeof window.marked !== 'undefined' &&
      typeof window.marked.parse === 'function'
    ) {

      try {

        textDiv.innerHTML =
          window.marked.parse(
            text || ''
          );

      } catch (e) {

        textDiv.innerHTML =
          (text || '').replace(
            /\n/g,
            '<br>'
          );

      }

    } else {

      textDiv.innerHTML =
        (text || '').replace(
          /\n/g,
          '<br>'
        );

    }


    contentDiv.appendChild(
      textDiv
    );


    if (
      buttons &&
      buttons.length > 0
    ) {

      const buttonsDiv =
        document.createElement('div');


      buttonsDiv.className =
        'testpan-message-buttons';


      buttons.forEach(
        button => {

          const buttonEl =
            document.createElement('button');


          buttonEl.className =
            'testpan-quick-reply-btn';


          buttonEl.textContent =
            button.label;


          buttonEl.type =
            'button';


          buttonEl.addEventListener(
            'click',
            () => {

              buttonEl.disabled =
                true;


              sendQuickReply(
                button
              );

            },
            { once: true }
          );


          buttonsDiv.appendChild(
            buttonEl
          );

        }
      );


      contentDiv.appendChild(
        buttonsDiv
      );

    }


    messageDiv.appendChild(
      contentDiv
    );


    container.appendChild(
      messageDiv
    );


    messageDiv.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });


    messageHistory.push({
      type: 'bot',
      text,
      buttons
    });

  }


  function showTypingIndicator() {

    const container =
      document.getElementById(
        'testpan-messages-container'
      );


    if (!container) {
      return;
    }


    removeTypingIndicator();


    const typingDiv =
      document.createElement('div');


    typingDiv.id =
      'testpan-typing-indicator';


    typingDiv.className =
      'testpan-message testpan-bot-message testpan-typing-indicator';


    typingDiv.innerHTML = `

      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>

      <span class="typing-text">
        Bot is typing
      </span>

    `;


    container.appendChild(
      typingDiv
    );


    typingDiv.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });


    return typingDiv;

  }


  function removeTypingIndicator() {

    const typingDiv =
      document.getElementById(
        'testpan-typing-indicator'
      );


    if (typingDiv) {
      typingDiv.remove();
    }

  }


  function addSystemMessage(text) {

    const container =
      document.getElementById(
        'testpan-messages-container'
      );


    if (!container) {
      return;
    }


    const messageDiv =
      document.createElement('div');


    messageDiv.className =
      'testpan-message testpan-system-message';


    messageDiv.textContent =
      text;


    container.appendChild(
      messageDiv
    );


    scrollToBottom();

  }


  function scrollToBottom() {

    const container =
      document.getElementById(
        'testpan-messages-container'
      );


    if (container) {

      container.scrollTop =
        container.scrollHeight;

    }

  }


  function getInput() {

    return document.getElementById(
      'testpan-message-input'
    );

  }


  // Initialize when DOM is ready.
  if (
    document.readyState === 'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      init
    );

  } else {

    init();

  }


  // Expose functions globally.
  window.toggleTestpanWidget =
    toggleWidget;


  window.getTestpanInput =
    getInput;


})();