'use strict';
const DEFAULTS = { enabled: true, tau: 35, gain: 1 };
const $ = (id) => document.getElementById(id);

function render(c) {
  $('enabled').checked = c.enabled;
  $('tau').value = c.tau;
  $('gain').value = c.gain;
  $('tauOut').textContent = c.tau === 0 ? 'off' : c.tau + ' ms';
  $('gainOut').textContent = Number(c.gain).toFixed(2) + 'x';
  $('controls').classList.toggle('disabled', !c.enabled);
}

async function load() {
  render(await chrome.storage.sync.get(DEFAULTS));
}

function save(patch) {
  chrome.storage.sync.set(patch);
}

$('enabled').addEventListener('change', (e) => { save({ enabled: e.target.checked }); });
$('tau').addEventListener('input', (e) => { save({ tau: Number(e.target.value) }); });
$('gain').addEventListener('input', (e) => { save({ gain: Number(e.target.value) }); });
$('reset').addEventListener('click', () => { chrome.storage.sync.set(DEFAULTS); });

chrome.storage.onChanged.addListener((_c, area) => { if (area === 'sync') load(); });

async function checkStatus() {
  const dot = $('dot'), text = $('statusText');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const s = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
    if (s && s.patched) {
      dot.className = 'dot ok';
      text.textContent = s.enabled ? 'Active on this tab' : 'Loaded, smoothing off';
    } else {
      dot.className = 'dot warn';
      text.textContent = 'Waiting for the 3D view. If this stays, reload the tab.';
    }
  } catch (_) {
    dot.className = 'dot';
    text.textContent = 'Open an Onshape document to use it.';
  }
}

load();
checkStatus();
