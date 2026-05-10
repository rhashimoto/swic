/** @import { Config} from "./types/index" */
export {};

const SERVICE_WORKER_URL = '/swic.js';

// Register the service worker and fetch configuration.
/** @type {Config} */ let swConfig;
const swStatus = /** @type {HTMLElement} */ (document.getElementById('sw-status'));
await navigator.serviceWorker.register(new URL(SERVICE_WORKER_URL, import.meta.url), { type: 'module' });
while (true) {
  swStatus.textContent = 'not ready';
  const response = await fetch('https://swic.test/config');
  if (response.ok) {
    swConfig = await response.json();
    swStatus.textContent = 'ready';
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Configure isEnabled UI.
document.querySelector(`input[name="isEnabled"][value="${swConfig.isEnabled}"]`)
  ?.setAttribute('checked', '');
document.getElementById('isEnabled')?.addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement) {
    swConfig.isEnabled = event.target.value === 'true';
    fetch('https://swic.test/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(swConfig),
    }).catch(e => {
      swStatus.textContent = `error: ${e.message}`;
      console.error(e);
    });
  }
});

const matchContainer = document.getElementById('match-container');
const matchButton = /** @type {HTMLButtonElement} */ (document.getElementById('match-button'));
const buildMatchUI = (function() {
  const template = /** @type {HTMLTemplateElement} */
    (document.getElementById('pattern-template'));

  return function(/** @type {string} */ pattern) {
    const container = /** @type {HTMLElement} */
      (/** @type {HTMLElement} */ (template.content.cloneNode(true)).firstElementChild);
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input'));
    input.value = pattern;
    input.addEventListener('input', () => {
      matchButton.disabled = false;
    });

    container.querySelector('button[name="add"]')?.addEventListener('click', () => {
      const newRow = buildMatchUI('');
      container.insertAdjacentElement('afterend', newRow);
    });
    container.querySelector('button[name="remove"]')?.addEventListener('click', () => {
      container.remove();
      matchButton.disabled = false;
      if (matchContainer?.childElementCount === 0) {
        const newRow = buildMatchUI('');
        matchContainer.appendChild(newRow);
      }
    });
    return container;
  };
})();

// Configure match UI.
swConfig.match.forEach((/** @type {string} */ pattern) => {
  const row = buildMatchUI(pattern);
  matchContainer?.appendChild(row);
});
if (swConfig.match.length === 0) {
  const row = buildMatchUI('');
  matchContainer?.appendChild(row);
}

matchButton.disabled = true;
matchButton.addEventListener('click', event => {
  const newMatch = Array.from(matchContainer?.querySelectorAll('input') ?? [])
    .map(input => input.value)
    .filter(value => value.trim() !== '');
  swConfig.match = newMatch;
  fetch('https://swic.test/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(swConfig),
  }).catch(e => {
    swStatus.textContent = `error: ${e.message}`;
    console.error(e);
  });
  matchButton.disabled = true;
});

const exportButton = /** @type {HTMLButtonElement} */ (document.getElementById('export-button'));
exportButton.addEventListener('click', async () => {
  const response = await fetch('https://swic.test/coverage');
  if (response.ok) {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coverage.json';
    a.click();
    URL.revokeObjectURL(url);
  } else {
    swStatus.textContent = `error: ${response.statusText}`;
  }
});

const clearButton = /** @type {HTMLButtonElement} */ (document.getElementById('clear-button'));
clearButton.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all coverage data? This action cannot be undone.')) {
    const response = await fetch('https://swic.test/coverage', { method: 'DELETE' });
    if (!response.ok) {
      swStatus.textContent = `error: ${response.statusText}`;
    }
  }
});