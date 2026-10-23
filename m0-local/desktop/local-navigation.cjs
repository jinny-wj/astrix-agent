'use strict';

// Electron can settle loadURL while the old page's beforeunload is still
// pending. Observe the requested main-frame document, rather than treating
// that Promise as proof that navigation has committed.
function navigateAndWait(contents, url, { timeoutMs = 20000, trace = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let committed = false;
    let finished = false;
    let settled = false;
    const matches = value => value === url;
    const cleanup = () => {
      clearTimeout(timer);
      contents.removeListener('did-navigate', navigated);
      contents.removeListener('did-navigate-in-page', navigatedInPage);
      contents.removeListener('did-finish-load', loaded);
      contents.removeListener('did-fail-load', failed);
      contents.removeListener('destroyed', destroyed);
    };
    const settle = error => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const check = () => { if (committed && finished && matches(contents.getURL())) settle(); };
    function navigated(_event, actual) {
      if (!matches(actual)) return;
      committed = true;
      trace('main-frame-committed', { url: actual });
      check();
    }
    function navigatedInPage(_event, actual, isMainFrame) {
      if (!isMainFrame || !matches(actual)) return;
      committed = true;
      finished = true;
      check();
    }
    function loaded() {
      if (!matches(contents.getURL())) return;
      finished = true;
      trace('main-frame-loaded', { url: contents.getURL() });
      check();
    }
    function failed(_event, code, description, actual, isMainFrame) {
      if (isMainFrame && matches(actual)) settle(new Error(`Local page failed to load (${code}): ${description}`));
    }
    function destroyed() { settle(new Error('Local application window was closed during navigation')); }
    const timer = setTimeout(() => settle(new Error('Local page navigation timed out')), timeoutMs);
    contents.on('did-navigate', navigated);
    contents.on('did-navigate-in-page', navigatedInPage);
    contents.on('did-finish-load', loaded);
    contents.on('did-fail-load', failed);
    contents.once('destroyed', destroyed);
    try {
      Promise.resolve(contents.loadURL(url)).catch(error => settle(error));
    } catch (error) { settle(error); }
  });
}

module.exports = { navigateAndWait };
