/**
 * Testpan Chatbot Widget Loader
 *
 * This single script is responsible for dynamically loading all necessary
 * assets (CSS, Socket.IO, and the main widget script) to run the chatbot.
 * This is the only script that needs to be embedded on a live website.
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

  // Use a timestamp as a cache-busting query parameter.
  const cacheBuster = `v=${new Date().getTime()}`;

  const assets = {
    socketio: 'https://cdn.socket.io/4.7.2/socket.io.min.js',
    css: `${serverUrl}/style.css?${cacheBuster}`,
    marked: 'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
    widget: `${serverUrl}/chatWidget.js?${cacheBuster}`,
  };

  /**
   * Loads a <script> dynamically into the document's <head>.
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');

      script.src = src;
      // Removed script.async = true; to ensure synchronous, blocking load order.

      script.onload = () => resolve();

      script.onerror = () =>
        reject(new Error(`Failed to load script: ${src}`));

      document.head.appendChild(script);
    });
  }

  /**
   * Loads a <link> stylesheet dynamically into the document's <head>.
   */
  function loadCss(href) {
    const link = document.createElement('link');

    link.rel = 'stylesheet';
    link.href = href;

    document.head.appendChild(link);
  }

  /*
   * Create a global configuration object for chatWidget.js.
   *
   * If site=bmtc was passed to widget.html, it will now correctly
   * reach chatWidget.js.
   */
  window.TESTPAN_CHAT_CONFIG = {
    serverUrl: serverUrl,
    site: siteParam || window.location.hostname
  };

  console.log('Testpan Chat Config:', window.TESTPAN_CHAT_CONFIG);

  // Load CSS.
  loadCss(assets.css);

  // Chain the script loading to guarantee order:
  // 1. Load Socket.IO
  // 2. Then load Marked.js
  // 3. Finally, load the main widget script.
  loadScript(assets.socketio)
    .then(() => loadScript(assets.marked))
    .then(() => loadScript(assets.widget))
    .catch(error => console.error('Testpan Chat Widget failed to load a critical script:', error));
})();