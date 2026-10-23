'use strict';
// Exercise the real desktop entry point's handling of its local settings popup.
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const reportPath = path.resolve(__dirname, '../diagnostics/desktop-settings-check.json');
const watchdog = setTimeout(() => app.exit(1), 20_000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const navigated = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
      await window.webContents.executeJavaScript(`(() => {
        const settings = document.querySelector('a[href="/__local/settings"]');
        if (!settings) throw new Error('Local settings link not found');
        settings.click();
      })()`, true);
      await navigated;
      const url = window.webContents.getURL();
      if (!new URL(url).pathname.startsWith('/__local/settings')) throw new Error('Desktop local settings did not open');
      await fs.writeFile(reportPath, JSON.stringify({ ok: true, url, title: window.getTitle() }, null, 2));
      clearTimeout(watchdog);
      app.exit(0);
    } catch (error) {
      await fs.writeFile(reportPath, JSON.stringify({ ok: false, error: error.message }, null, 2));
      clearTimeout(watchdog);
      app.exit(1);
    }
  });
});
require('../desktop/main.cjs');
