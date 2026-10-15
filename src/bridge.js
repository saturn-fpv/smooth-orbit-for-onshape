// Smooth Orbit for Onshape - bridge (isolated world)
// Relays settings between extension storage / popup and the page script.
(() => {
  'use strict';
  const DEFAULTS = { enabled: true, tau: 35, gain: 1 };
  let status = { patched: false, enabled: true };

  const send = (name, data) =>
    document.dispatchEvent(new CustomEvent('smooth-orbit:' + name, { detail: JSON.stringify(data) }));

  async function pushConfig() {
    try { send('config', await chrome.storage.sync.get(DEFAULTS)); } catch (_) {}
  }

  pushConfig();
  document.addEventListener('smooth-orbit:request', pushConfig);

  document.addEventListener('smooth-orbit:status', (e) => {
    try { status = JSON.parse(e.detail); } catch (_) {}
  });

  // F8 in the page changes "enabled"; persist it so the popup stays in sync.
  document.addEventListener('smooth-orbit:set', (e) => {
    try { chrome.storage.sync.set(JSON.parse(e.detail)); } catch (_) {}
  });

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') pushConfig();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'status') {
      // The page script answers synchronously, so status is fresh here.
      document.dispatchEvent(new CustomEvent('smooth-orbit:status-request'));
      reply(status);
    }
  });
})();
