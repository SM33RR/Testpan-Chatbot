/**
 * Testpan Chatbot Widget Loader
 *
 * This single script is responsible for dynamically loading all necessary
 * assets (CSS, Socket.IO, and the main widget script) to run the chatbot.
 * This is the only script that needs to be embedded on a live website.
 */
(function() {
  // Find this script element to determine the server URL and any query parameters.
  const thisScript = document.currentScript;
  if (!thisScript) {
    console.error("Testpan Chat Widget: Could not find the loader script tag.");
    return;
  }

  const scriptUrl = new URL(thisScript.src);
  const serverUrl = scriptUrl.origin;
  const siteParam = scriptUrl.searchParams.get('site');

  const assets = {
    socketio: 'https://cdn.socket.io/4.7.2/socket.io.min.js',
    css: `${serverUrl}/style.css?v=1.0`, // Add versioning to prevent caching issues
    widget: `${serverUrl}/chatWidget.js`
  };

  /**
   * Loads a <script> dynamically into the document's <head>.
   * @param {string} src - The source URL of the script.
   * @returns {Promise<void>} - A promise that resolves when the script is loaded.
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  /**
   * Loads a <link> stylesheet dynamically into the document's <head>.
   * @param {string} href - The href URL of the stylesheet.
   */
  function loadCss(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  // Create a global configuration object for the main widget script to use.
  // This is more reliable than having the widget script try to find its own URL.
  window.TESTPAN_CHAT_CONFIG = {
    serverUrl: serverUrl,
    site: siteParam || window.location.hostname
  };

  // Load assets in the correct order.
  loadCss(assets.css);
  // Load Socket.IO first, then the main widget script.
  loadScript(assets.socketio).then(() => loadScript(assets.widget)).catch(console.error);
})();