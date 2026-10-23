// SPDX-License-Identifier: MPL-2.0
import { connect, disconnect } from './auth.ts';
import { ClipperError, errorMessageKey, serializeError } from './errors.ts';
import { localize, t } from './i18n.ts';
import { send } from './messages.ts';
import { parseServerUrl } from './server-url.ts';
import { applyTokens } from './theme.ts';

applyTokens();
localize();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('connect-form');
const input = $<HTMLInputElement>('server-url');
const connectButton = $<HTMLButtonElement>('connect');
const errorBox = $<HTMLParagraphElement>('error');
const connectedPanel = $<HTMLElement>('connected');
const connectPanel = $<HTMLElement>('connect-panel');

$('extension-id').textContent = chrome.runtime.id;
$('redirect-uri').textContent = chrome.identity.getRedirectURL('auth');

function showError(err: unknown) {
  const { kind } = serializeError(err);
  errorBox.textContent = t(errorMessageKey(kind));
  if (kind === 'auth_cancelled' || kind === 'auth_failed')
    errorBox.textContent += ` ${t('connect_hint_ids')}`;
  errorBox.hidden = false;
}

async function render() {
  const status = await send('status', {});
  connectPanel.hidden = status.connected;
  connectedPanel.hidden = !status.connected;
  if (status.serverUrl && !input.value) input.value = status.serverUrl;
  $('revoked').hidden = !status.revoked;
  if (status.connected && status.user) {
    $('connected-user').textContent = `${status.user.name} · ${status.user.email}`;
    $('connected-server').textContent = status.serverUrl ?? '';
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const address = parseServerUrl(input.value);
  if (!address) {
    showError(new ClipperError('invalid_server'));
    return;
  }
  connectButton.disabled = true;
  // Asked before any await: Chrome only shows the prompt during the click.
  chrome.permissions
    .request({ origins: [address.originPattern] })
    .then((granted) => {
      if (!granted) throw new ClipperError('permission_denied');
      return connect(address.base);
    })
    .then(render)
    .catch(showError)
    .finally(() => {
      connectButton.disabled = false;
    });
});

$('disconnect').addEventListener('click', () => {
  disconnect().then(render).catch(showError);
});

$('shortcuts').addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void render();

void chrome.commands.getAll().then((commands) => {
  const shortcut = commands.find((c) => c.name === 'save-page')?.shortcut;
  $('shortcut').textContent = shortcut || t('help_shortcut_unset');
});
