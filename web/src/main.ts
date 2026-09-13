import './style.css';
import { createElement, type IconNode, Coffee, Sunrise, TreePine, Utensils, Hand, ShoppingBasket, TramFront, House, Users, Briefcase, CloudRain, Mountain, Music, Film, BookOpen, PenLine, Sparkles, Globe, Wine, Building2, Flag, MessageSquareQuote, Send, Newspaper, SlidersHorizontal, Mic, MicOff, PhoneOff, MessageSquareText, Captions, AudioLines, LayoutGrid, Search, ArrowUpRight, History, X, Download, Upload, Trash2, EyeOff, Check } from 'lucide';
import { CredentialStore } from './api';
import { LanguageRegistry, MeaningLanguages, themesFor, type ConversationTheme } from './core/languages';
import { passageText, sessionPassages } from './core/models';
import { levelLabel, wordLabel, wordExplanation } from './core/engine';
import { LearningStore } from './storage';
import { Coordinator } from './coordinator';
import { loadVoiceSettings, saveVoiceSettings, DEFAULT_BRIDGE } from './voice';

// SF Symbols used by the iOS app → Lucide equivalents.
const SYMBOLS: Record<string, IconNode> = {
  'cup.and.saucer': Coffee, 'sun.horizon': Sunrise, tree: TreePine, 'fork.knife': Utensils, 'hand.wave': Hand, basket: ShoppingBasket,
  tram: TramFront, house: House, 'person.2': Users, briefcase: Briefcase, 'cloud.rain': CloudRain, 'mountain.2': Mountain, 'music.note': Music,
  film: Film, book: BookOpen, 'pencil.and.outline': PenLine, sparkles: Sparkles, 'globe.europe.africa': Globe, wineglass: Wine,
  'building.2': Building2, flag: Flag, 'quote.bubble': MessageSquareQuote, paperplane: Send, newspaper: Newspaper,
};
const icon = (node: IconNode, size = 24) => createElement(node, { width: String(size), height: String(size), 'stroke-width': '1.75' }).outerHTML;
const escape = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const app = document.getElementById('app')!;
app.innerHTML = `
  <audio id="remote-audio" autoplay playsinline></audio>
  <div class="app">
    <header class="top">
      <div class="brand"><span class="dot"></span>mural</div>
      <button id="open-settings" class="icon-btn" type="button" aria-label="Settings">${icon(SlidersHorizontal)}</button>
    </header>

    <section id="view-talk" class="view talk" aria-label="Talk">
      <span id="theme-pill" class="chip"></span>
      <div id="orb-wrap" class="orb-wrap" data-state="idle"><span class="ring outer"></span><span class="ring"></span><div id="orb" class="orb"></div><span class="sat a"></span><span class="sat b"></span></div>
      <p id="status" class="status"></p>
      <h2 id="caption" class="caption"></h2>
      <p id="meaning" class="meaning" hidden></p>
      <p id="you" class="you" hidden></p>
      <p id="notice" class="notice" hidden></p>
      <p id="error" class="error" hidden></p>
      <div class="controls">
        <div class="control"><button id="btn-meaning" class="round" type="button">${icon(MessageSquareText)}</button><span>Meaning</span></div>
        <div class="control"><button id="btn-mic" class="round mic" type="button">${icon(Mic)}</button></div>
        <div class="control"><button id="btn-right" class="round" type="button">${icon(Captions)}</button><span id="btn-right-label">Transcript</span></div>
      </div>
      <p id="mic-label" class="mic-label"></p>
      <div class="helpers"><span id="welcome-line">English is welcome, too.</span><button id="btn-help" type="button" hidden>${icon(Sparkles, 20)} A little help</button></div>
      <div id="transcript-panel" class="panel" hidden><h3>Transcript</h3><ol id="transcript"></ol><div id="lookup" class="lookup" hidden></div><details class="log"><summary>Event log</summary><pre id="log"></pre></details></div>
    </section>

    <section id="view-themes" class="view" aria-label="Themes">
      <label class="search">${icon(Search)}<input id="theme-search" type="search" placeholder="Find a conversation" /></label>
      <p class="eyebrow">A place to begin</p>
      <h1 class="display">What’s on your mind?</h1>
      <p class="lede">Same friend. Somewhere new.</p>
      <button id="just-talk" class="just-talk" type="button">${icon(AudioLines, 26)} Just talk <span class="arrow">${icon(ArrowUpRight, 26)}</span></button>
      <div id="chips" class="chips"></div>
      <div id="theme-grid" class="grid"></div>
    </section>

    <section id="view-words" class="view" aria-label="Words">
      <label class="search">${icon(Search)}<input id="word-search" type="search" placeholder="Find a word" /></label>
      <p id="words-eyebrow" class="eyebrow"></p>
      <h1 class="display">Your words.</h1>
      <p class="lede">Familiar words, ready for another conversation.</p>
      <p id="level" class="hint"></p>
      <p id="next-goal" class="hint"></p>
      <ul id="word-list" class="words-list"></ul>
      <div class="legend"><span>1 · Fragile</span><span>2 · Growing</span><span>3 · Steady</span></div>
      <p class="foot">The bars estimate spoken recall, not permanent mastery. Using a word with visible meanings counts as supported practice.</p>
      <div class="history"><h2>${icon(History, 20)} Past conversations</h2><ul id="session-list"></ul></div>
    </section>
  </div>

  <nav class="tabbar" aria-label="Sections">
    <button class="tab" data-tab="talk" type="button">${icon(AudioLines, 26)}<span>Talk</span></button>
    <button class="tab" data-tab="themes" type="button">${icon(LayoutGrid, 26)}<span>Themes</span></button>
    <button class="tab" data-tab="words" type="button">${icon(BookOpen, 26)}<span>Words</span></button>
  </nav>

  <div id="overlay" class="overlay" hidden></div>
  <aside id="sheet" class="sheet" hidden aria-label="Settings" style="position:fixed">
    <div class="grab"></div>
    <button id="close-settings" class="close" type="button" aria-label="Close">${icon(X, 22)}</button>
    <h2>Settings</h2>
    <label>OpenAI API key <input id="key" type="password" autocomplete="off" placeholder="sk-…" /></label>
    <div class="row"><button id="save-key" class="btn" type="button">${icon(Check, 18)} Save key</button><button id="clear-key" class="btn secondary" type="button">Remove</button><span id="key-status" class="status-line"></span></div>
    <label>Provider <select id="voice-provider"><option value="api">OpenAI API key (gpt-live-1 + gpt-5.6-luna)</option><option value="codex">Codex subscription via local bridge (gpt-live-1-codex + gpt-5.6-luna)</option></select></label>
    <label id="bridge-row">Bridge URL <input id="bridge-url" type="url" placeholder="${DEFAULT_BRIDGE}" /><span class="hint">When the bridge is on your Tailscale network, the browser asks once to allow this site to reach devices on your local network. Allow it, or the conversation never connects.</span></label>
    <label>Learning language <select id="language"></select></label>
    <label>Meaning language <select id="meaning-language"></select></label>
    <label>Interests (optional) <input id="interests" type="text" placeholder="Music, cycling, film…" /></label>
    <label>Conversation limit (minutes) <input id="minutes" type="number" min="1" max="60" /></label>
    <div class="row">
      <button id="export" class="btn secondary" type="button">${icon(Download, 18)} Export backup</button>
      <label class="file">${icon(Upload, 18)} Import backup <input id="import" type="file" accept="application/json,.json" hidden /></label>
    </div>
    <div class="row"><button id="delete-all" class="btn danger" type="button">${icon(Trash2, 18)} Delete all learning data</button></div>
    <p class="hint">With the Codex provider no key is needed: voice, subtitles, assessments and lookups all run on the subscription through the local bridge. Your key stays in this browser and is sent only to api.openai.com. Conversations and words live in this browser; export a backup to keep them. Backups are compatible with the iPhone app.</p>
    <p id="store-error" class="error" hidden></p>
  </aside>`;

const store = await LearningStore.open();
const coordinator = new Coordinator(store, $<HTMLAudioElement>('remote-audio'));

// ---------- Tabs ----------
type Tab = 'talk' | 'themes' | 'words';
let tab: Tab = (() => { try { return (localStorage.getItem('mural.tab') as Tab) || 'talk'; } catch { return 'talk'; } })();
function showTab(next: Tab) {
  tab = next; try { localStorage.setItem('mural.tab', next); } catch {}
  for (const v of ['talk', 'themes', 'words'] as Tab[]) { $(`view-${v}`).classList.toggle('active', v === next); }
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === next));
  window.scrollTo({ top: 0 });
  if (next === 'words') renderWords();
}
document.querySelectorAll<HTMLButtonElement>('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab as Tab));

// ---------- Settings sheet ----------
const languageSelect = $<HTMLSelectElement>('language');
for (const l of LanguageRegistry.all) languageSelect.add(new Option(`${l.name} · ${l.variety}`, l.id));
const meaningSelect = $<HTMLSelectElement>('meaning-language');
for (const m of MeaningLanguages.all) meaningSelect.add(new Option(m, m));
function openSettings(open: boolean) { $('sheet').hidden = !open; $('overlay').hidden = !open; if (open) renderSettings(); }
$('open-settings').onclick = () => openSettings(true);
$('close-settings').onclick = () => openSettings(false);
$('overlay').onclick = () => openSettings(false);
function refreshKeyStatus() { const s = $('key-status'); s.textContent = CredentialStore.hasKey ? 'Key saved' : 'No key yet'; s.classList.toggle('ok', CredentialStore.hasKey); }
$('save-key').onclick = () => {
  try { CredentialStore.save($<HTMLInputElement>('key').value); $<HTMLInputElement>('key').value = ''; coordinator.error = undefined; }
  catch (e: any) { coordinator.error = e.message; }
  refreshKeyStatus(); render();
};
$('clear-key').onclick = () => { CredentialStore.delete(); refreshKeyStatus(); };
languageSelect.onchange = () => { coordinator.selectLanguage(languageSelect.value); renderThemes(); renderWords(); render(); };
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
  (e.target as HTMLInputElement).value = ''; renderWords(); render(); openSettings(false);
};
$('delete-all').onclick = () => { if (confirm('Delete all conversations and learned words from this browser?')) { coordinator.deleteLearningData(); renderWords(); render(); openSettings(false); } };
const providerSelect = $<HTMLSelectElement>('voice-provider'), bridgeInput = $<HTMLInputElement>('bridge-url');
const canStart = () => loadVoiceSettings().provider === 'codex' || CredentialStore.hasKey;
providerSelect.onchange = () => { const v = loadVoiceSettings(); v.provider = providerSelect.value as 'api' | 'codex'; saveVoiceSettings(v); renderSettings(); };
bridgeInput.onchange = () => { const v = loadVoiceSettings(); v.bridgeURL = bridgeInput.value.trim() || DEFAULT_BRIDGE; saveVoiceSettings(v); renderSettings(); };
function renderSettings() {
  const p = store.preferences, v = loadVoiceSettings();
  providerSelect.value = v.provider; bridgeInput.value = v.bridgeURL; $('bridge-row').hidden = v.provider !== 'codex';
  languageSelect.value = p.learningLanguageID; meaningSelect.value = p.meaningLanguage;
  $<HTMLInputElement>('interests').value = p.interests; $<HTMLInputElement>('minutes').value = String(p.sessionMinutes);
  const err = $('store-error'); err.hidden = !store.error; err.textContent = store.error ?? '';
  refreshKeyStatus();
}

// ---------- Talk ----------
$('btn-mic').onclick = () => {
  if (coordinator.state === 'active') coordinator.toggleMute();
  else if (!coordinator.isRunning) { if (!canStart()) openSettings(true); else coordinator.start(); }
};
$('btn-meaning').onclick = () => coordinator.toggleMeaning();
$('btn-right').onclick = () => { if (coordinator.state === 'active' || coordinator.state === 'connecting') coordinator.end(); else { const p = $('transcript-panel'); p.hidden = !p.hidden; } };
$('btn-help').onclick = () => coordinator.help();
$('meaning').onclick = e => { if ((e.target as HTMLElement).classList.contains('retry')) coordinator.retryMeaning(); };
$('caption').onclick = async e => {
  const target = e.target as HTMLElement;
  if (!target.dataset.word) return;
  const box = $('lookup'); $('transcript-panel').hidden = false; box.hidden = false; box.textContent = `Looking up “${target.dataset.word}”…`;
  try { box.textContent = await coordinator.lookup(target.dataset.word, coordinator.caption); }
  catch (err: any) { if (err?.name !== 'AbortError') box.textContent = err?.message ?? String(err); }
};

function render() {
  const c = coordinator, p = store.preferences;
  $('theme-pill').textContent = c.selectedTheme?.title ?? `A little everyday ${c.language.name}`;
  const wrap = $('orb-wrap'); wrap.dataset.state = c.state; wrap.dataset.who = c.outputLevel > c.inputLevel ? 'assistant' : 'user';
  $('orb').style.setProperty('--level', Math.max(c.inputLevel, c.outputLevel).toFixed(3));
  $('status').textContent = c.status ?? '';
  $('caption').innerHTML = c.caption.split(/(\s+)/).map(part => /^\s*$/.test(part) ? escape(part) : `<span class="w" data-word="${escape(part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))}">${escape(part)}</span>`).join('');
  const meaning = $('meaning');
  const showMeaning = p.meaningVisible && (c.meaning || c.translating || c.meaningError || !c.session);
  meaning.hidden = !showMeaning;
  meaning.classList.toggle('loading', c.translating && !c.meaning);
  if (!c.session) meaning.textContent = MeaningLanguages.greeting(p.meaningLanguage);
  else if (c.meaningError) meaning.innerHTML = `${escape(c.meaningError)} <button class="retry" type="button">Retry</button>`;
  else meaning.textContent = c.meaning || (c.translating ? 'Translating…' : '');
  const you = c.userPassage; const youEl = $('you'); youEl.hidden = !you;
  if (you) youEl.innerHTML = `<span class="eyebrow">You</span>${escape(passageText(you))}`;
  const notice = $('notice'); notice.hidden = !c.notice; notice.textContent = c.notice ?? '';
  const error = $('error'); error.hidden = !c.error; error.textContent = c.error ?? '';
  const active = c.state === 'active', busy = c.state === 'connecting' || c.state === 'closing';
  const mic = $<HTMLButtonElement>('btn-mic');
  mic.classList.toggle('muted', active && c.isMuted); mic.classList.toggle('busy', busy); mic.disabled = busy;
  mic.innerHTML = icon(active && c.isMuted ? MicOff : Mic, 34);
  mic.setAttribute('aria-label', active ? (c.isMuted ? 'Unmute' : 'Mute') : 'Start conversation');
  $('mic-label').textContent = c.state === 'active' ? (c.isMuted ? 'Microphone muted' : 'Microphone on') : c.state === 'connecting' ? 'Connecting microphone' : 'Microphone off';
  $('btn-meaning').classList.toggle('on', p.meaningVisible);
  const right = $('btn-right'), rightLabel = $('btn-right-label');
  if (active || c.state === 'connecting') { right.innerHTML = icon(PhoneOff); rightLabel.textContent = 'End'; }
  else { right.innerHTML = icon(Captions); rightLabel.textContent = 'Transcript'; }
  $('btn-help').hidden = !active; $('welcome-line').hidden = active;
  const list = $('transcript');
  const html = c.passages.map(p => `<li class="${p.speaker}"><span class="who">${p.speaker === 'user' ? 'You' : 'Mural'}</span><span>${escape(passageText(p))}</span></li>`).join('');
  if (list.innerHTML !== html) { list.innerHTML = html; list.lastElementChild?.scrollIntoView({ block: 'nearest' }); }
  if (!c.session) $('lookup').hidden = true;
  const log = $('log'); const text = c.log.slice(-80).join('\n'); if (log.textContent !== text) { log.textContent = text; log.scrollTop = log.scrollHeight; }
}

// ---------- Themes ----------
let category = 'All';
const categories = ['All', 'Everyday', 'Connection', 'Local life', 'Interests'];
function pickTheme(theme?: ConversationTheme) {
  if (coordinator.isRunning) { coordinator.chooseTheme(theme); showTab('talk'); return; }
  coordinator.chooseTheme(theme); showTab('talk');
  if (canStart()) coordinator.start(); else openSettings(true);
}
$('just-talk').onclick = () => pickTheme(undefined);
$<HTMLInputElement>('theme-search').oninput = () => renderThemes();
function renderThemes() {
  $('chips').innerHTML = categories.map(c => `<button type="button" class="${c === category ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('');
  const q = $<HTMLInputElement>('theme-search').value.trim().toLowerCase();
  const themes = themesFor(coordinator.language).filter(t => (category === 'All' || t.category === category) &&
    (!q || `${t.title} ${t.subtitle} ${t.situation}`.toLowerCase().includes(q)));
  $('theme-grid').innerHTML = themes.map(t => `<button type="button" class="card c${t.colorIndex}${coordinator.selectedTheme?.id === t.id ? ' selected' : ''}" data-theme="${t.id}">${icon(SYMBOLS[t.symbol] ?? Sparkles, 40)}<strong>${escape(t.title)}</strong><span>${escape(t.subtitle)}</span></button>`).join('') || '<p class="empty">No conversation matches that.</p>';
}
$('chips').onclick = e => { const cat = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]')?.dataset.cat; if (cat) { category = cat; renderThemes(); } };
$('theme-grid').onclick = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-theme]')?.dataset.theme; if (id) pickTheme(themesFor(coordinator.language).find(t => t.id === id)); };

// ---------- Words ----------
$<HTMLInputElement>('word-search').oninput = () => renderWords();
function renderWords() {
  const learner = store.learner, language = coordinator.language;
  $('words-eyebrow').textContent = `Little by little · ${language.name}`;
  $('level').textContent = `${levelLabel(learner)} · challenge ${learner.challenge}/5 · ${learner.observationCount} observation${learner.observationCount === 1 ? '' : 's'}${learner.capabilities.length ? ' · can do: ' + learner.capabilities.join(', ') : ''}`;
  $('next-goal').textContent = learner.observationCount ? `Next: ${learner.nextGoal}` : '';
  const q = $<HTMLInputElement>('word-search').value.trim().toLowerCase();
  const words = learner.words.filter(w => !q || `${w.lemma} ${w.meaning} ${w.form}`.toLowerCase().includes(q));
  $('word-list').innerHTML = words.length ? words.map(w => `
    <li>
      <div><div class="lemma">${escape(w.lemma)}</div><div class="sense">${escape(w.meaning)}</div><div class="why">${escape(wordExplanation(w))} <em>“${escape(w.example)}”</em>${w.dueAt < Date.now() ? ' · due' : ''}</div></div>
      <div class="recall"><div class="bars" aria-label="${wordLabel(w)}">${[1, 2, 3].map(i => `<i class="${i <= w.bars ? 'on' : ''}"></i>`).join('')}</div><span>${wordLabel(w)}</span><button type="button" class="hide" data-hide="${escape(w.id)}">${icon(EyeOff, 14)} Hide</button></div>
    </li>`).join('') : `<li class="empty">${learner.words.length ? 'No word matches that.' : `Words you use in ${language.name} conversations appear here, with one to three bars for how well you recall them.`}</li>`;
  const sessions = store.learningSessions;
  $('session-list').innerHTML = sessions.length ? sessions.slice(0, 30).map(s => {
    const minutes = Math.round(s.voiceSeconds / 60), when = new Date(s.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `<li><div><strong>${escape(s.title)}</strong><span class="hint">${when} · ${minutes} min · ${sessionPassages(s).length} turns · ${s.assessments.length} assessment${s.assessments.length === 1 ? '' : 's'}</span></div><button type="button" data-delete="${s.id}" aria-label="Delete">${icon(Trash2, 18)}</button></li>`;
  }).join('') : '<li class="empty">No conversations yet.</li>';
}
$('word-list').onclick = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-hide]')?.dataset.hide; if (id) { store.hideWord(id); renderWords(); } };
$('session-list').onclick = e => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-delete]')?.dataset.delete;
  if (id && confirm('Delete this conversation and its learning evidence?')) { if (coordinator.session?.id === id && !coordinator.isRunning) coordinator.resetConversation(); store.deleteSession(id); renderWords(); render(); }
};

coordinator.onChange = render;
store.onChange = () => { if (tab === 'words') renderWords(); };
renderSettings(); renderThemes(); renderWords(); render(); showTab(tab);

// Development hook so an automated browser can drive the coordinator (never shipped in production builds).
if (import.meta.env.DEV) (window as any).mural = { coordinator, store, showTab };
