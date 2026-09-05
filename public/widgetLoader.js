/**
 * Testpan Chatbot Widget Loader
 *
 * This script is responsible for:
 * 1. Creating the chat launcher button and the iframe container.
 * 2. Dynamically loading all necessary assets (CSS, Socket.IO, widget script).
 * 3. Managing the visibility of the launcher and the chat iframe.
 */


(function() {
  // Find this script element to determine the server URL.
  const thisScript = document.currentScript;

  if (!thisScript) {
    console.error("Testpan Chat Widget: Could not find the loader script tag.");
    return;
  }

  const scriptUrl = new URL(thisScript.src);
  const serverUrl = scriptUrl.origin;

  /*
   * IMPORTANT:
   *
   * The loader itself is loaded as:
   * /widgetLoader.js
   *
   * But widget.html may be opened as:
   * /widget.html?site=bmtc
   *
   * Therefore, first check the loader script URL, then check the
   * current page URL for the site parameter.
   */
  const siteParam =
    scriptUrl.searchParams.get('site') ||
    new URLSearchParams(window.location.search).get('site');

  const widgetPosition = thisScript.getAttribute('data-position') || 'bottom-right';
  const autoOpen = thisScript.getAttribute('data-auto-open') === 'true';
  const primaryColor = thisScript.getAttribute('data-primary-color') || '#0052A3';

  // Use a timestamp as a cache-busting query parameter.
  const cacheBuster = `v=${new Date().getTime()}`;

  const assets = {
    socketio: 'https://cdn.socket.io/4.7.2/socket.io.min.js',
    css: `${serverUrl}/style.css?${cacheBuster}`,
    marked: 'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
    widget: `${serverUrl}/chatWidget.js?${cacheBuster}`,
  };

  // Create widget elements
  const launcher = document.createElement('button');
  launcher.id = 'testpan-chat-launcher';
  launcher.className = 'testpan-launcher';
  launcher.style.backgroundColor = primaryColor;
  launcher.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="white"/>
    </svg>
  `;

  const iframeContainer = document.createElement('div');
  iframeContainer.id = 'testpan-chat-iframe-container';
  iframeContainer.className = `testpan-iframe-container ${widgetPosition}`;

  const iframe = document.createElement('iframe');
  iframe.id = 'testpan-chat-iframe';
  iframe.src = `${serverUrl}/widget.html?site=${siteParam || ''}&${cacheBuster}`;
  iframe.style.border = 'none';
  iframe.style.width = '100%';
  iframe.style.height = '100%';

  iframeContainer.appendChild(iframe);
  document.body.appendChild(launcher);
  document.body.appendChild(iframeContainer);

  // Load CSS for launcher and iframe container
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = assets.css;
  document.head.appendChild(link);

  let isWidgetOpen = false;

  function openWidget() {
    if (isWidgetOpen) return;
    iframeContainer.style.display = 'block';
    launcher.style.display = 'none';
    isWidgetOpen = true;
  }

  function closeWidget() {
    if (!isWidgetOpen) return;
    iframeContainer.style.display = 'none';
    launcher.style.display = 'block';
    isWidgetOpen = false;
  }

  // Event listeners
  launcher.addEventListener('click', openWidget);

  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) return;

    if (event.data === 'testpan-chat-close') {
      closeWidget();
    }
  });

  // Initial state
  if (autoOpen) {
    openWidget();
  } else {
    closeWidget();
  }

  // The following is only needed for the non-iframe version (test.html)
  if (window.location.pathname.includes('test.html')) {
    /**
     * Loads a <script> dynamically into the document's <head>.
     */
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
      });
    }

    window.TESTPAN_CHAT_CONFIG = {
      serverUrl: serverUrl,
      site: siteParam || window.location.hostname
    };

    // Chain script loading for non-iframe context
    loadScript(assets.socketio)
      .then(() => loadScript(assets.marked))
      .then(() => loadScript(assets.widget))
      .catch(error => console.error('Testpan Chat Widget failed to load a critical script:', error));
  }
})();