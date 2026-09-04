/**
 * Testpan Chatbot Widget Loader
 *
 * This single script is responsible for dynamically loading all necessary
 * assets (CSS, Socket.IO, and the main widget script) to run the chatbot.
 * This is the only script that needs to be embedded on a live website.
 */
(function() {
  // Use the same origin as the server serving this script.
  const serverUrl = new URL(document.currentScript.src).origin;

  const assets = {
    socketio: 'https://cdn.socket.io/4.7.2/socket.io.min.js',
    css: `${serverUrl}/style.css`,
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

  // Load assets in the correct order.
  loadCss(assets.css);
  loadScript(assets.socketio).then(() => loadScript(assets.widget));
})();