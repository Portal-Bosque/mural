import './style.css';
import { CredentialStore } from './api';
import { LanguageRegistry, MeaningLanguages, themesFor } from './core/languages';
import { passageText, sessionPassages } from './core/models';
import { levelLabel, wordLabel, wordExplanation } from './core/engine';
import { LearningStore } from './storage';
import { Coordinator } from './coordinator';

const app = document.getElementById('app')!;
app.innerHTML = `
  <audio id="remote-audio" autoplay playsinline></audio>
  <header>
    <h1>Mural <span class="tag">web</span></h1>
    <details id="settings">
      <summary>Settings</summary>
      <label>OpenAI API key <input id="key" type="password" autocomplete="off" placeholder="sk-…" /></label>
      <div class="row"><button id="save-key" type="button">Save key</button><button id="clear-key" type="button" class="ghost">Remove</button><span id="key-status"></span></div>
      <label>Learning language <select id="language"></select></label>
      <label>Meaning language <select id="meaning-language"></select></label>
      <label>Interests (optional) <input id="interests" type="text" placeholder="Music, cycling, film…" /></label>
      <label>Conversation limit (minutes) <input id="minutes" type="number" min="1" max="60" /></label>
      <div class="row">
        <button id="export" type="button">Export learning backup</button>
        <label class="file">Import backup <input id="import" type="file" accept="application/json,.json" hidden /></label>
        <button id="delete-all" type="button" class="danger">Delete all learning data</button>
      </div>
      <p class="hint">The key is stored only in this browser’s local storage for this origin and sent only to api.openai.com. Conversations and vocabulary live in this browser’s IndexedDB; export a backup to keep them. Backups are compatible with the iPhone app.</p>
      <p id="store-error" class="error" hidden></p>
    </details>
  </header>
  <main>
    <section class="stage">
      <div id="orb" class="orb"><div class="core"></div></div>
      <p id="caption" class="caption"></p>
      <div id="meaning-box" class="meaning" hidden><p id="meaning"></p><p id="meaning-state" class="hint"></p><button id="retry-meaning" type="button" class="ghost small" hidden>Retry</button></div>
      <p id="status" class="status"></p>
      <p id="notice" class="notice" hidden></p>
      <p id="error" class="error" hidden></p>
      <div class="controls">
        <button id="start" type="button" class="primary">Start conversation</button>
        <button id="mute" type="button" hidden>Mute</button>
        <button id="help" type="button" hidden>Simpler, please</button>
        <button id="end" type="button" class="danger" hidden>End</button>
        <button id="toggle-meaning" type="button" class="ghost">Meaning</button>
      </div>
      <div class="themes"><label>Theme <select id="theme"><option value="">Free conversation</option></select></label></div>
    </section>
    <section class="transcript"><h2>Transcript</h2><ol id="transcript"></ol><p id="lookup" class="hint" hidden></p></section>
    <section class="words">
      <div class="row between"><h2>Words</h2><span id="level" class="hint"></span></div>
      <p id="next-goal" class="hint"></p>
      <p id="capabilities" class="hint"></p>
      <ul id="word-list"></ul>
    </section>
    <section class="history"><h2>Conversations</h2><ul id="session-list"></ul></section>
    <section class="meta">
      <div><span>Voice seconds</span><strong id="seconds">0</strong></div>
      <div><span>Tokens</span><strong id="tokens">0</strong></div>
      <div><span>State</span><strong id="state">idle</strong></div>
      <details><summary>Event log</summary><pre id="log"></pre></details>
    </section>
  </main>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

const store = await LearningStore.open();
const coordinator = new Coordinator(store, $<HTMLAudioElement>('remote-audio'));

// ---------- Settings ----------
const languageSelect = $<HTMLSelectElement>('language');
for (const l of LanguageRegistry.all) languageSelect.add(new Option(`${l.name} · ${l.variety}`, l.id));
const meaningSelect = $<HTMLSelectElement>('meaning-language');
for (const m of MeaningLanguages.all) meaningSelect.add(new Option(m, m));
const themeSelect = $<HTMLSelectElement>('theme');
function fillThemes() {
  themeSelect.length = 1;
  for (const t of themesFor(coordinator.language)) themeSelect.add(new Option(`${t.title} — ${t.subtitle}`, t.id));
  themeSelect.value = coordinator.selectedTheme?.id ?? '';
}
function refreshKeyStatus() { $('key-status').textContent = CredentialStore.hasKey ? 'Key saved' : 'No key'; }
refreshKeyStatus();
$('save-key').onclick = () => {
  try { CredentialStore.save($<HTMLInputElement>('key').value); $<HTMLInputElement>('key').value = ''; coordinator.error = undefined; }
  catch (e: any) { coordinator.error = e.message; }
  refreshKeyStatus(); render();
};
$('clear-key').onclick = () => { CredentialStore.delete(); refreshKeyStatus(); };
languageSelect.onchange = () => { coordinator.selectLanguage(languageSelect.value); fillThemes(); renderLibrary(); render(); };
meaningSelect.onchange = () => coordinator.selectMeaningLanguage(meaningSelect.value);
$<HTMLInputElement>('interests').onchange = e => store.updatePreferences(p => { p.interests = (e.target as HTMLInputElement).value.slice(0, 500); });
$<HTMLInputElement>('minutes').onchange = e => { const v = Math.min(60, Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 15))); store.updatePreferences(p => { p.sessionMinutes = v; }); };
$('export').onclick = () => {
  const blob = new Blob([store.exportData()], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `mural-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$<HTMLInputElement>('import').onchange = async e => {
  const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
  try { await store.importFile(file); coordinator.notice = 'Backup imported.'; } catch (err: any) { coordinator.error = err?.message ?? String(err); }
  (e.target as HTMLInputElement).value = ''; renderLibrary(); render();
};
$('delete-all').onclick = () => { if (confirm('Delete all conversations and learned words from this browser?')) { coordinator.deleteLearningData(); renderLibrary(); render(); } };
themeSelect.onchange = () => coordinator.chooseTheme(themesFor(coordinator.language).find(t => t.id === themeSelect.value));
$('start').onclick = () => coordinator.start();
$('mute').onclick = () => coordinator.toggleMute();
$('help').onclick = () => coordinator.help();
$('end').onclick = () => coordinator.end();
$('toggle-meaning').onclick = () => coordinator.toggleMeaning();
$('retry-meaning').onclick = () => coordinator.retryMeaning();

// Tap a word in the caption to ask what it means in context.
$('caption').onclick = async e => {
  const target = e.target as HTMLElement;
  if (!target.dataset.word) return;
  const box = $('lookup'); box.hidden = false; box.textContent = `Looking up “${target.dataset.word}”…`;
  try { box.textContent = await coordinator.lookup(target.dataset.word, coordinator.caption); }
  catch (err: any) { if (err?.name !== 'AbortError') box.textContent = err?.message ?? String(err); }
};

// ---------- Rendering ----------
function renderSettings() {
  const p = store.preferences;
  languageSelect.value = p.learningLanguageID; meaningSelect.value = p.meaningLanguage;
  $<HTMLInputElement>('interests').value = p.interests; $<HTMLInputElement>('minutes').value = String(p.sessionMinutes);
  const err = $('store-error'); err.hidden = !store.error; err.textContent = store.error ?? '';
}
function render() {
  const c = coordinator, p = store.preferences;
  $('caption').innerHTML = c.caption.split(/(\s+)/).map(part => /^\s*$/.test(part) ? escape(part) : `<span class="w" data-word="${escape(part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))}">${escape(part)}</span>`).join('');
  const meaningBox = $('meaning-box'); meaningBox.hidden = !p.meaningVisible || (!c.meaning && !c.translating && !c.meaningError);
  $('meaning').textContent = c.meaning;
  $('meaning-state').textContent = c.translating ? 'Translating…' : c.meaningError ?? '';
  $('retry-meaning').hidden = !c.meaningError;
  $('toggle-meaning').textContent = p.meaningVisible ? 'Meaning: on' : 'Meaning: off';
  $('status').textContent = c.status ?? '';
  $('state').textContent = c.state + (c.working ? ' · looking something up' : '');
  $('seconds').textContent = String(Math.round(c.session?.voiceSeconds ?? 0));
  $('tokens').textContent = String((c.session?.inputTokens ?? 0) + (c.session?.outputTokens ?? 0));
  const notice = $('notice'); notice.hidden = !c.notice; notice.textContent = c.notice ?? '';
  const error = $('error'); error.hidden = !c.error; error.textContent = c.error ?? '';
  const running = c.isRunning;
  $('start').hidden = running; $('mute').hidden = c.state !== 'active'; $('help').hidden = c.state !== 'active';
  $('end').hidden = !(c.state === 'active' || c.state === 'connecting');
  $('mute').textContent = c.isMuted ? 'Unmute' : 'Mute';
  $('start').textContent = c.state === 'ended' || c.state === 'failed' ? 'New conversation' : 'Start conversation';
  languageSelect.disabled = running;
  const orb = $('orb');
  orb.style.setProperty('--level', Math.max(c.inputLevel, c.outputLevel).toFixed(3));
  orb.dataset.state = c.state; orb.dataset.who = c.outputLevel > c.inputLevel ? 'assistant' : 'user';
  const list = $('transcript');
  const html = c.passages.map(p => `<li class="${p.speaker}"><span class="who">${p.speaker === 'user' ? 'You' : 'Mural'}</span>${escape(passageText(p))}</li>`).join('');
  if (list.innerHTML !== html) { list.innerHTML = html; list.lastElementChild?.scrollIntoView({ block: 'nearest' }); }
  if (!c.session) $('lookup').hidden = true;
  const log = $('log'); const text = c.log.slice(-80).join('\n'); if (log.textContent !== text) { log.textContent = text; log.scrollTop = log.scrollHeight; }
}
function renderLibrary() {
  renderSettings();
  const learner = store.learner;
  $('level').textContent = `${levelLabel(learner)} · challenge ${learner.challenge}/5 · ${learner.observationCount} observations`;
  $('next-goal').textContent = `Next goal: ${learner.nextGoal}`;
  $('capabilities').textContent = learner.capabilities.length ? `Can do: ${learner.capabilities.join(' · ')}` : '';
  $('word-list').innerHTML = learner.words.length ? learner.words.map(w => `
    <li>
      <div class="bars" aria-label="${wordLabel(w)}">${[1, 2, 3].map(i => `<i class="${i <= w.bars ? 'on' : ''}"></i>`).join('')}</div>
      <div class="word"><strong>${escape(w.lemma)}</strong> <span class="hint">${escape(w.meaning)}</span><div class="hint">${escape(wordExplanation(w))} <em>“${escape(w.example)}”</em>${w.dueAt < Date.now() ? ' · due' : ''}</div></div>
      <button type="button" class="ghost small" data-hide="${escape(w.id)}">Hide</button>
    </li>`).join('') : `<li class="hint">Words you use in ${coordinator.language.name} conversations appear here, with one to three bars for how well you recall them.</li>`;
  const sessions = store.learningSessions;
  $('session-list').innerHTML = sessions.length ? sessions.slice(0, 30).map(s => {
    const passages = sessionPassages(s), minutes = Math.round(s.voiceSeconds / 60), when = new Date(s.startedAt).toLocaleString();
    return `<li><div><strong>${escape(s.title)}</strong> <span class="hint">${when} · ${minutes} min voice · ${passages.length} turns · ${s.assessments.length} assessments${s.endReason ? ' · ' + escape(s.endReason) : ''}</span></div><button type="button" class="ghost small" data-delete="${s.id}">Delete</button></li>`;
  }).join('') : '<li class="hint">No conversations yet.</li>';
}
$('word-list').onclick = e => { const id = (e.target as HTMLElement).dataset.hide; if (id) { store.hideWord(id); renderLibrary(); } };
$('session-list').onclick = e => {
  const id = (e.target as HTMLElement).dataset.delete;
  if (id && confirm('Delete this conversation and its learning evidence?')) { if (coordinator.session?.id === id && !coordinator.isRunning) coordinator.resetConversation(); store.deleteSession(id); renderLibrary(); render(); }
};
coordinator.onChange = render;
store.onChange = () => renderLibrary();
fillThemes(); renderLibrary(); render();

// Development hook so an automated browser can drive the coordinator (never shipped in production builds).
if (import.meta.env.DEV) (window as any).mural = { coordinator, store };
