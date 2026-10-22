import type { KeepAwakeStatus } from "./api";
import { agentBrandMark } from './agent-runtime';
import { APP_LOCALE_OPTIONS, type AppLocale, type TranslationKey } from './i18n';
import type { AgentRuntimeAvailability, RelayProvider } from './types';

export type WarmTab = 'home' | 'devices' | 'settings' | 'help' | 'agents' | 'account';
export type SettingsSection = 'general' | 'agents' | 'files' | 'account';
type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Move existing controls, preserving their listeners and native command guards. */
export function installWarmShell(options: {
  t: Translate;
  navigate: (tab: WarmTab) => void;
  settings: (trigger: HTMLElement, section: SettingsSection) => void;
  checkUpdates: () => void;
  language: (locale: AppLocale) => void;
  launchAtLogin: (enabled: boolean) => void;
  preventLock: (enabled: boolean) => void;
  openPage: (destination: "privacy" | "terms" | "changelog", button: HTMLButtonElement) => void;
}) {
  const { t } = options;
  const get = (id: string) => document.getElementById(id)!;
  const button = (key: TranslationKey, onClick: (button: HTMLButtonElement) => void, className = 'warm-link') => {
    const el = document.createElement('button');
    el.type = 'button'; el.dataset.i18n = key; el.className = className;
    el.textContent = t(key); el.addEventListener('click', () => onClick(el));
    return el;
  };
  const home = get('minimal-home');
  const account = document.createElement('div'); account.className = 'warm-account';
  const labels = { home: 'warmOverview', devices: 'warmConnections', agents: 'warmAgentsTab', settings: 'settings', account: 'warmAccountTab', help: 'warmHelp' } as const;
  const moon = document.createElement('div'); moon.className = 'moonlight-emblem';
  moon.setAttribute('aria-hidden', 'true');
  moon.innerHTML = '<svg viewBox="0 0 40 40"><path d="M29 27A14 14 0 0 1 14 7a14 14 0 1 0 15 20Z" fill="currentColor"/></svg>';
  const machine = document.createElement('div'); machine.className = 'moonlight-machine';
  machine.innerHTML = '<span id="moonlight-device-name"></span><span class="moonlight-connection"><i></i><span id="moonlight-connection-label"></span></span>';
  home.prepend(moon, machine);
  const backgroundNote = home.querySelector('.minimal-footer')!;
  const accountEntry = get('minimal-account') as HTMLButtonElement;
  accountEntry.querySelector('.minimal-account-chevron')!.textContent = '⌃';
  accountEntry.setAttribute('aria-haspopup', 'dialog');
  accountEntry.setAttribute('aria-controls', 'moonlight-account-dialog');
  accountEntry.setAttribute('aria-expanded', 'false');
  const footer = document.createElement('footer'); footer.className = 'moonlight-footer'; footer.append(accountEntry);
  const actions = document.createElement('div'); actions.className = 'warm-home-actions';
  actions.append(get('minimal-connect'), get('minimal-home-action'));
  home.querySelector('.minimal-home-summary')!.after(actions);
  const agents = document.createElement('section'); agents.className = 'warm-agents';
  agents.innerHTML = '<div class="warm-section-heading"><h2>Agent</h2></div><div id="warm-agent-list" aria-live="polite"></div>';
  agents.querySelector('div')!.append(button('warmAllAgents', el => options.settings(el, 'agents')));
  home.append(agents, get('minimal-manage'), backgroundNote);
  for (const name of ['settings', 'help', 'agents', 'account'] as const) {
    const section = document.createElement('section'); section.id = (name === 'account' ? 'minimal-account-page' : `minimal-${name}`);
    section.className = 'minimal-screen is-hidden'; section.inert = true;
    section.innerHTML = `<h2 tabindex="-1" data-i18n="${labels[name]}">${t(labels[name])}</h2>`;
    get('home-view').append(section);
  }
  const general = document.createElement('section');
  general.className = 'warm-general';
  general.innerHTML = `<h3 data-i18n="warmGeneral">${t('warmGeneral')}</h3><label class="warm-general-row"><span data-i18n="chooseLanguage">${t('chooseLanguage')}</span><select id="warm-language"></select></label><div class="warm-general-row"><span data-i18n="runAtLogin">${t('runAtLogin')}</span><label class="switch"><input id="warm-launch-at-login" type="checkbox" data-i18n-aria-label="runAtLogin" aria-label="${t('runAtLogin')}" /><span></span></label></div>`;
  const language = general.querySelector<HTMLSelectElement>('select')!;
  for (const { code, label, direction } of APP_LOCALE_OPTIONS) {
    const option = document.createElement('option'); option.value = code; option.textContent = label; option.lang = code; option.dir = direction; language.append(option);
  }
  language.addEventListener('change', () => options.language(language.value as AppLocale));
  const launch = general.querySelector<HTMLInputElement>('input')!;
  launch.addEventListener('change', () => options.launchAtLogin(launch.checked));
  const lockRow = document.createElement('div');
  lockRow.className = 'warm-general-row'; lockRow.hidden = true;
  lockRow.innerHTML = `<div><span data-i18n="preventLockTitle">${t('preventLockTitle')}</span><p class="warm-prevent-lock-help" data-i18n="preventLockHelp">${t('preventLockHelp')}</p></div><label class="switch"><input id="warm-prevent-lock" type="checkbox" data-i18n-aria-label="preventLockTitle" aria-label="${t('preventLockTitle')}" disabled /><span></span></label>`;
  const preventLock = lockRow.querySelector<HTMLInputElement>('input')!;
  preventLock.addEventListener('change', () => options.preventLock(preventLock.checked));
  general.append(lockRow);
  const refreshPreventLock = (status: KeepAwakeStatus | null, busy: boolean, macos: boolean) => {
    lockRow.hidden = !macos;
    preventLock.disabled = busy || !status?.supported;
    preventLock.checked = Boolean(status?.prevent_lock);
    lockRow.querySelector('span')!.textContent = t(status?.lock_prevention_stopping ? 'preventLockStopping' : status?.prevent_lock && status.error && !status.lock_prevention_active ? 'preventLockUnavailable' : 'preventLockTitle');
  };
  get('minimal-settings').append(general);
  general.id = 'warm-section-general';
  const sections = new Map<string, HTMLElement>();
  for (const [name, key] of [['files', 'warmFiles'], ['agents', 'warmAgentManagement'], ['account', 'warmAccount']] as const) {
    const section = document.createElement('section');
    section.id = `warm-section-${name}`; section.className = 'warm-settings-section';
    section.innerHTML = `<h3 tabindex="-1" data-i18n="${key}">${t(key)}</h3>`;
    sections.set(name, section); get(name === 'files' ? 'minimal-settings' : (name === 'account' ? 'minimal-account-page' : `minimal-${name}`)).append(section);
  }
  const filePermissions = document.createElement('div'); filePermissions.className = 'warm-file-permissions';
  const grantAction = get('prepare-task-files').querySelector<HTMLElement>('.row-action')!;
  grantAction.dataset.i18n = 'warmGrantAccess'; grantAction.textContent = t('warmGrantAccess');
  const systemPermissions = get('open-file-access-settings');
  systemPermissions.dataset.i18n = 'warmSystemPermissions'; systemPermissions.textContent = t('warmSystemPermissions');
  filePermissions.append(get('prepare-task-files'), systemPermissions);
  sections.get('files')!.append(get('choose-workspace'), filePermissions, get('file-access-warning'));
  sections.get('agents')!.append(get('agent-readiness'));
  const agentHint = document.createElement('p'); agentHint.className = 'moonlight-agent-hint';
  agentHint.dataset.i18n = 'warmAgentScopeDetail'; agentHint.textContent = t('warmAgentScopeDetail');
  sections.get('agents')!.append(agentHint);
  account.innerHTML = `<span class="moonlight-profile-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></span><div class="moonlight-profile-copy"><strong id="moonlight-account-identity" dir="auto"></strong><span class="moonlight-profile-status" data-i18n="signedInStatus">${t('signedInStatus')}</span></div>`;
  sections.get('account')!.append(account, get('account-card'), get('logout-button'));
  const accountDialog = document.createElement('dialog');
  accountDialog.id = 'moonlight-account-dialog';
  accountDialog.setAttribute('aria-labelledby', 'moonlight-account-title');
  const accountPage = get('minimal-account-page');
  accountPage.classList.remove('is-hidden'); accountPage.inert = false;
  accountPage.querySelector('h2')!.id = 'moonlight-account-title';
  const accountClose = document.createElement('button');
  accountClose.type = 'button'; accountClose.className = 'moonlight-account-close';
  accountClose.dataset.i18nAriaLabel = 'closeAccount'; accountClose.setAttribute('aria-label', t('closeAccount'));
  accountClose.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>';
  accountClose.addEventListener('click', () => accountDialog.close());
  const accountHeader = document.createElement('header'); accountHeader.className = 'moonlight-account-header';
  accountHeader.append(get('moonlight-account-title'), accountClose);
  accountPage.prepend(accountHeader);
  accountDialog.append(accountPage); document.querySelector('.shell')!.append(accountDialog);
  accountDialog.addEventListener('close', () => {
    accountEntry.setAttribute('aria-expanded', 'false');
    if (accountEntry.isConnected && !accountEntry.disabled && !get('home-view').classList.contains('is-hidden')) accountEntry.focus({ preventScroll: true });
  });
  accountDialog.addEventListener('click', event => {
    if (event.target !== accountDialog) return;
    const rect = accountDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) accountDialog.close();
  });
  const openAccount = () => {
    if (accountEntry.disabled) return;
    if (!accountDialog.open) accountDialog.showModal();
    accountEntry.setAttribute('aria-expanded', 'true');
    accountClose.focus({ preventScroll: true });
  };
  // Keep the signed-in identity in the dedicated account panel.
  get('account-card').querySelector('.account-login-status')?.remove();
  get('account-card').querySelector('.eyebrow')?.remove();
  const accountExit = document.createElement('div'); accountExit.className = 'moonlight-account-exit';
  get('logout-button').before(accountExit); accountExit.append(get('logout-button'));
  const focusSection = (name: SettingsSection) => {
    const section = name === 'general' ? general : sections.get(name)!;
    const heading = name === 'agents' || name === 'account' ? section.parentElement!.querySelector<HTMLElement>('h2')! : section.querySelector<HTMLElement>('h3')!;
    heading.tabIndex = -1; heading.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const help = get('minimal-settings');
  help.append(get('open-feedback'), get('open-diagnostics'));
  for (const id of ['open-feedback', 'open-diagnostics']) get(id).className = 'minimal-navigation-row';
  const about = document.createElement('section'); about.className = 'warm-about';
  about.innerHTML = `<h3 data-i18n="warmAbout">${t('warmAbout')}</h3><div class="warm-section-heading"><span id="warm-version"></span></div>`;
  about.querySelector('div')!.append(button('warmCheckUpdates', options.checkUpdates));
  help.append(about);
  about.append(button('warmChangelog', el => options.openPage('changelog', el), 'minimal-navigation-row'));
  // The existing update card remains global, so menu-triggered updates are visible on every tab.
  document.querySelector('.app-header')!.after(get('update-card'));
  const legal = document.createElement('div'); legal.className = 'warm-legal';
  for (const [key, destination] of [['privacyPolicy', 'privacy'], ['termsOfService', 'terms']] as const) {
    const el = button(key, el => options.openPage(destination, el));
    legal.append(el);
  }
  help.append(legal);
  document.querySelector('.header-settings-button')?.classList.add('warm-header-settings');
  const refresh = (input: { agents: readonly AgentRuntimeAvailability[]; checking: boolean; failed: boolean; version: string; name: (provider: RelayProvider) => string; status: (agent: AgentRuntimeAvailability) => string }) => {
    get('moonlight-account-identity').textContent = get('minimal-account-email').textContent;
    get('warm-version').textContent = `Relayune ${input.version}`;
    const list = get('warm-agent-list');
    // Do not replace focused rows on every polling refresh.
    for (const provider of ['codex', 'claude', 'kimi'] as const) {
      let row = list.querySelector<HTMLButtonElement>(`[data-warm-agent="${provider}"]`);
      if (!row) {
        row = button('warmAgentManagement', el => options.settings(el, 'agents'), 'warm-agent');
        delete row.dataset.i18n; row.dataset.warmAgent = provider;
        row.innerHTML = `<span class="moonlight-agent-icon" aria-hidden="true">${agentBrandMark(provider)}</span><span class="warm-agent-name"></span><span class="warm-agent-status"></span><span aria-hidden="true">›</span>`;
        list.append(row);
      }
      const runtime = input.agents.find(agent => agent.provider === provider);
      row.querySelector('.warm-agent-name')!.textContent = input.name(provider);
      row.querySelector('.warm-agent-status')!.textContent = input.checking ? t('warmChecking') : input.failed ? t('agentCheckFailed') : runtime ? runtime.status === 'ready' ? t('warmLoggedIn') : input.status(runtime) : t('agentCheckFailed');
      row.dataset.tone = !input.checking && !input.failed && runtime?.status === 'ready' ? 'success' : 'pending';
    }
  };
  const back = button('minimalBack', () => options.navigate('home'), 'moonlight-back');
  back.id = 'moonlight-back';
  const content = document.createElement('div'); content.className = 'warm-content'; content.append(back);
  for (const name of ['home', 'pairing', 'devices', 'agents', 'settings', 'help']) content.append(get(`minimal-${name}`));
  get('home-view').append(content, footer);
  get('minimal-devices').querySelector('.minimal-back')?.remove();
  // Support and about actions are direct settings entries, without a More submenu.
  const select = (screen: string) => {
    back.hidden = screen === 'home';
    if (accountDialog.open) accountDialog.close();
  };
  select('home');
  const setBusy = (busy: boolean) => {
    for (const control of document.querySelectorAll<HTMLButtonElement>('#minimal-account, #minimal-settings > button, .warm-agent, .warm-agents .warm-link, .warm-files')) control.disabled = busy;
  };
  const refreshGeneral = (locale: AppLocale, enabled: boolean, busy: boolean) => {
    language.value = locale; language.disabled = busy;
    if (!busy) launch.checked = enabled;
    launch.disabled = busy;
  };
  return { refresh, select, setBusy, refreshGeneral, refreshPreventLock, focusSection, openAccount, closeAccount: () => accountDialog.close() };
}
