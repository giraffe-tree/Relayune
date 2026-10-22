import { invoke } from '@tauri-apps/api/core';
import { feedbackEmailValid, MAX_FEEDBACK_IMAGES, type FeedbackImage, type FeedbackSubmission } from '../../shared/feedback.mjs';
import { prepareFeedbackImage } from './feedback-image';
import type { TranslationKey } from './i18n';
import { feedbackDescription, type ExitDiagnosticReport } from './exit-diagnostic-feedback';

type Info = { app_version: string | null; model: string | null; system: string | null; email?: string | null };

export function createFeedbackDialog(t: (key: TranslationKey) => string) {
  const dialog = document.createElement('dialog');
  dialog.className = 'feedback-dialog';
  dialog.setAttribute('aria-labelledby', 'feedback-title');
  dialog.innerHTML = `<form class="dialog-card feedback-card">
    <header><div><p class="eyebrow" data-feedback-text="feedbackTitle"></p><h2 id="feedback-title" data-feedback-text="feedbackIntro"></h2></div><button type="button" class="icon-button feedback-close" aria-label="Close">×</button></header>
    <div class="feedback-body">
    <p class="feedback-subtitle" data-feedback-text="feedbackSubtitle"></p>
    <div class="feedback-types" role="group">
      <button type="button" class="secondary" data-category="suggestion" aria-pressed="true" data-feedback-text="feedbackSuggestion"></button>
      <button type="button" class="secondary" data-category="bug" aria-pressed="false" data-feedback-text="feedbackBug"></button>
    </div>
    <section class="feedback-editor">
      <label class="feedback-description"><span data-feedback-text="feedbackDescription"></span><textarea maxlength="2000" rows="4" required></textarea><small class="feedback-count">0 / 2000</small></label>
      <div class="feedback-image-heading"><strong data-feedback-text="feedbackImages"></strong><small class="feedback-image-count">0 / 3</small></div>
      <div class="feedback-images"></div><input class="feedback-file" type="file" accept="image/*" multiple hidden>
      <small data-feedback-text="feedbackImagesHint"></small>
    </section>
    <section class="feedback-contact"><div class="feedback-image-heading"><strong data-feedback-text="feedbackContact"></strong><small data-feedback-text="feedbackOptional"></small></div>
      <div class="feedback-contact-fields"><label><span data-feedback-text="feedbackEmail"></span><input class="feedback-email" type="email" maxlength="254" autocomplete="email"><small data-feedback-text="feedbackEmailHint"></small></label>
      <label><span data-feedback-text="feedbackWechat"></span><input class="feedback-wechat" type="text" maxlength="64" autocapitalize="off" spellcheck="false"></label></div>
      <small data-feedback-text="feedbackContactHint"></small>
    </section>
    <section class="feedback-exit-diagnostics">
      <label><input type="checkbox" class="feedback-include-diagnostics"><span data-feedback-text="exitDiagnosticsInclude"></span></label>
      <p data-feedback-text="exitDiagnosticsPrivacy"></p>
      <details class="feedback-diagnostics-preview" hidden><summary data-feedback-text="exitDiagnosticsPreview"></summary><pre></pre></details>
      <p class="feedback-diagnostics-status" role="status"></p>
    </section>
    <section class="feedback-info"><strong data-feedback-text="feedbackInfo"></strong><dl></dl><p data-feedback-text="feedbackPrivacy"></p></section>
    </div>
    <footer class="feedback-footer"><p class="feedback-status" role="status" aria-live="polite"></p><button type="submit" class="primary" data-feedback-text="feedbackSend"></button><small data-feedback-text="feedbackSubmitNote"></small></footer>
  </form>`;
  document.body.append(dialog);
  const get = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
  const form = get<HTMLFormElement>('form');
  const description = get<HTMLTextAreaElement>('textarea');
  const submit = get<HTMLButtonElement>('[type=submit]');
  const email = get<HTMLInputElement>('.feedback-email');
  const wechat = get<HTMLInputElement>('.feedback-wechat');
  const fileInput = get<HTMLInputElement>('.feedback-file');
  let emailTouched = false;
  let picking = false;
  let images: FeedbackImage[] = [];
  const includeDiagnostics = get<HTMLInputElement>('.feedback-include-diagnostics');
  const diagnosticsPreview = get<HTMLDetailsElement>('.feedback-diagnostics-preview');
  const diagnosticsStatus = get<HTMLElement>('.feedback-diagnostics-status');
  let diagnosticReport: ExitDiagnosticReport | null = null;
  let diagnosticLoading = false;
  async function loadDiagnostics() {
    if (!includeDiagnostics.checked || diagnosticLoading || diagnosticReport) return;
    diagnosticLoading = true; diagnosticsStatus.textContent = t('exitDiagnosticsLoading');
    setBusy(false);
    try {
      const report = await invoke<ExitDiagnosticReport>('get_exit_diagnostic_report');
      if (!report.event_count) {
        includeDiagnostics.checked = false;
        diagnosticsStatus.textContent = t('exitDiagnosticsEmpty');
      } else {
        feedbackDescription('', report); // Enforce the bounded native contract before preview.
        diagnosticReport = report;
        get('.feedback-diagnostics-preview pre').textContent = report.text;
        diagnosticsPreview.hidden = !includeDiagnostics.checked;
        diagnosticsPreview.open = true;
        diagnosticsStatus.textContent = '';
      }
    } catch {
      includeDiagnostics.checked = false;
      diagnosticsStatus.textContent = t('exitDiagnosticsFailed');
    } finally { diagnosticLoading = false; setBusy(false); }
  }
  includeDiagnostics.addEventListener('change', () => {
    diagnosticsPreview.hidden = !includeDiagnostics.checked || !diagnosticReport;
    diagnosticsStatus.textContent = '';
    void loadDiagnostics();
  });
  email.addEventListener('input', () => { emailTouched = true; email.setCustomValidity(''); });
  const status = get<HTMLElement>('.feedback-status');
  let category: FeedbackSubmission['category'] = 'suggestion';
  let info: Info | null = null;
  let busy = false;
  let submittedId: string | null = null;
  let pending: { body: string; submission: FeedbackSubmission } | null = null;
  function translate() {
    dialog.querySelectorAll<HTMLElement>('[data-feedback-text]').forEach(el => {
      el.textContent = t(el.dataset.feedbackText as TranslationKey);
    });
    get('.icon-button').setAttribute('aria-label', t('feedbackDone'));
    get('.feedback-types').setAttribute('aria-label', t('feedbackTitle'));
    wechat.placeholder = t('feedbackWechatHint');
    description.placeholder = t(category === 'bug' ? 'feedbackBugHint' : 'feedbackSuggestionHint');
  }
  function environment() {
    return { app_version: info?.app_version || t('feedbackUnknown'),
      device_model: info?.model || t('feedbackUnknown'), os_version: info?.system || t('feedbackUnknown') };
  }
  function fields() {
    const data = environment();
    return { [t('feedbackVersion')]: data.app_version, [t('feedbackModel')]: data.device_model,
      [t('feedbackSystem')]: data.os_version };
  }
  function renderInfo() {
    const dl = get('dl');
    dl.replaceChildren();
    if (!info) { dl.textContent = t('feedbackLoading'); return; }
    for (const [label, value] of Object.entries(fields())) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      dl.append(dt, dd);
    }
  }
  function setBusy(value: boolean) {
    busy = value;
    form.setAttribute('aria-busy', String(value || picking));
    dialog.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement>('button, textarea, input').forEach(el => { el.disabled = value || picking; });
    submit.disabled = value || picking || diagnosticLoading || !info;
    submit.textContent = t(value ? 'feedbackSending' : picking ? 'feedbackPreparingImages' : 'feedbackSend');
  }
  function renderImages() {
    const container = get('.feedback-images');
    container.replaceChildren();
    get('.feedback-image-count').textContent = `${images.length} / ${MAX_FEEDBACK_IMAGES}`;
    images.forEach((attachment, index) => {
      const tile = document.createElement('div'); tile.className = 'feedback-image-tile';
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'feedback-thumbnail';
      preview.setAttribute('aria-label', `${t('feedbackImagePreview')} ${index + 1}`);
      const img = document.createElement('img'); img.src = `data:image/jpeg;base64,${attachment.data}`; img.alt = '';
      preview.append(img);
      preview.addEventListener('click', () => {
        const viewer = document.createElement('dialog'); viewer.className = 'feedback-image-viewer';
        viewer.setAttribute('aria-label', t('feedbackImagePreview'));
        const close = document.createElement('button'); close.type = 'button'; close.className = 'secondary'; close.textContent = t('feedbackDone');
        close.addEventListener('click', () => viewer.close());
        viewer.addEventListener('close', () => viewer.remove());
        viewer.append(img.cloneNode(), close); document.body.append(viewer); viewer.showModal();
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'feedback-remove-image'; remove.textContent = '×';
      remove.setAttribute('aria-label', `${t('feedbackRemoveImage')} ${index + 1}`);
      remove.addEventListener('click', () => { images.splice(index, 1); renderImages(); status.textContent = ''; });
      tile.append(preview, remove); container.append(tile);
    });
    if (images.length < MAX_FEEDBACK_IMAGES) {
      const add = document.createElement('button'); add.type = 'button'; add.className = 'feedback-add-image';
      const plus = document.createElement('span'); plus.textContent = '+';
      const label = document.createElement('span'); label.textContent = t('feedbackAddImage');
      add.append(plus, label); add.addEventListener('click', () => fileInput.click()); container.append(add);
    }
  }
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []); fileInput.value = '';
    if (!files.length || busy || picking) return;
    if (images.length + files.length > MAX_FEEDBACK_IMAGES) { status.textContent = t('feedbackImageLimit'); return; }
    picking = true; setBusy(false); status.textContent = '';
    try {
      const prepared: FeedbackImage[] = [];
      for (const file of files) prepared.push(await prepareFeedbackImage(file));
      images = [...images, ...prepared]; renderImages();
    } catch { status.textContent = t('feedbackImageFailed'); }
    finally { picking = false; setBusy(false); }
  });
  description.addEventListener('input', () => {
    get('.feedback-count').textContent = `${description.value.length} / 2000`;
    status.textContent = '';
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button => {
    button.addEventListener('click', () => {
      category = button.dataset.category === 'bug' ? 'bug' : 'suggestion';
      dialog.querySelectorAll<HTMLElement>('[data-category]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
      description.placeholder = t(category === 'bug' ? 'feedbackBugHint' : 'feedbackSuggestionHint');
    });
  });
  dialog.querySelectorAll('.feedback-close').forEach(button => button.addEventListener('click', () => { if (!busy && !picking) dialog.close(); }));
  dialog.addEventListener('close', () => { if (submittedId) dialog.remove(); });
  dialog.addEventListener('cancel', event => { if (busy || picking) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || picking || diagnosticLoading || !info || submittedId) return;
    if (!description.value.trim()) { status.textContent = t('feedbackEmpty'); description.focus(); return; }
    if (!feedbackEmailValid(email.value.trim())) { status.textContent = t('feedbackEmailInvalid'); email.focus(); return; }
    let submittedDescription: string;
    try {
      if (includeDiagnostics.checked && !diagnosticReport) throw new Error('missing_report');
      submittedDescription = feedbackDescription(description.value, includeDiagnostics.checked ? diagnosticReport : null);
    } catch { status.textContent = t('exitDiagnosticsTooLong'); return; }
    const payload = { contact: { email: email.value.trim(), wechat: wechat.value.trim() }, images, category, description: submittedDescription, environment: environment(), client: 'desktop' as const };
    const body = JSON.stringify(payload);
    setBusy(true); status.textContent = '';
    try {
      if (!pending || pending.body !== body) {
        pending = { body, submission: { id: crypto.randomUUID().replaceAll('-', ''), ...payload } };
      }
      const response = await invoke<{ id: string }>('feedback_request', { action: 'submit', submission: JSON.stringify(pending.submission) });
      if (response.id !== pending.submission.id) throw new Error('feedback_invalid_response');
      submittedId = response.id;
      form.replaceChildren();
      const heading = document.createElement('h2'); heading.id = 'feedback-title'; heading.textContent = t('feedbackSuccess');
      const reference = document.createElement('p'); reference.textContent = t('feedbackReference');
      const code = document.createElement('p'); code.className = 'feedback-reference'; code.textContent = submittedId;
      const done = document.createElement('button'); done.type = 'button'; done.className = 'primary'; done.textContent = t('feedbackDone');
      done.addEventListener('click', () => dialog.close());
      form.append(heading, reference, code, done);
      busy = false; form.removeAttribute('aria-busy'); done.focus();
    } catch {
      status.textContent = t('feedbackFailed'); setBusy(false);
    }
  });
  return {
    get completed() { return submittedId !== null; },
    dispose() {
      dialog.close(); dialog.remove();
      images = []; pending = null; info = null; diagnosticReport = null;
      description.value = ''; email.value = ''; wechat.value = '';
    },
    async open(withExitDiagnostics = false) {
      if (submittedId) { dialog.showModal(); return; }
      translate(); renderInfo(); renderImages(); setBusy(false);
      if (withExitDiagnostics) {
        category = 'bug';
        dialog.querySelectorAll<HTMLElement>('[data-category]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.category === 'bug')));
        includeDiagnostics.checked = true;
        diagnosticsPreview.hidden = !diagnosticReport;
        translate();
        void loadDiagnostics();
      }
      dialog.showModal();
      if (!info) {
        try { info = await invoke<Info>('feedback_request', { action: 'info', submission: null }); }
        catch { info = { app_version: null, model: null, system: null }; }
        if (!emailTouched) email.value = info.email || '';
        renderInfo(); setBusy(false);
      }
    },
  };
}
