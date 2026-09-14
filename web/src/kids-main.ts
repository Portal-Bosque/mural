// Kids profile (ages 6–10): one big button, a topic picker, XP that grows while you talk, and a summary at the end.
import './style.css';
import { createElement, Mic, Square, Settings, Shuffle, Sparkles, Star, Clock, RotateCcw, X, Check } from 'lucide';
import { CredentialStore } from './api';
import { LanguageRegistry, MeaningLanguages } from './core/languages';
import { passageText, sessionPassages } from './core/models';
import { LearningStore, KIDS_KEY } from './storage';
import { Coordinator } from './coordinator';
import { kidsThemes, randomKidsTheme, type KidsTheme } from './core/kids-themes';
import { loadVoiceSettings, saveVoiceSettings, DEFAULT_BRIDGE } from './voice';

const icon = (node: Parameters<typeof createElement>[0], size = 28) => createElement(node, { width: String(size), height: String(size), 'stroke-width': '2.25' }).outerHTML;
const escape = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- XP ----------
const XP_KEY = 'mural.kids.xp';
const XP = { perFiveSeconds: 1, perThingSaid: 5, perNewWord: 10, perLevel: 100 };
let totalXP = (() => { try { return Number(localStorage.getItem(XP_KEY) ?? 0) || 0; } catch { return 0; } })();
const saveXP = () => { try { localStorage.setItem(XP_KEY, String(totalXP)); } catch {} };
const level = (xp: number) => Math.floor(xp / XP.perLevel) + 1;

const app = document.getElementById('app')!;
app.innerHTML = `
  <audio id="remote-audio" autoplay playsinline></audio>
  <div class="app kids-app">
    <header class="top">
      <div class="brand"><span class="dot"></span>mural <span class="kids-tag">kids</span></div>
      <div class="xp-badge" id="xp-badge"><span class="star">${icon(Star, 20)}</span><b id="xp-total">0</b> XP · <span id="xp-level">Level 1</span></div>
      <button id="open-settings" class="icon-btn" type="button" aria-label="Grown-ups">${icon(Settings, 22)}</button>
    </header>
    <div class="xp-bar"><i id="xp-fill"></i></div>

    <section id="screen-pick" class="kscreen">
      <h1 class="kids-title">What do you want to talk about?</h1>
      <button id="surprise" class="kbtn surprise" type="button">${icon(Shuffle, 26)} Surprise me!</button>
      <div id="topic-grid" class="topic-grid"></div>
    </section>

    <section id="screen-talk" class="kscreen" hidden>
      <div class="topic-pill"><span id="talk-emoji"></span><span id="talk-title"></span></div>
      <div id="buddy" class="buddy" data-state="idle"><span class="face" id="buddy-face">🙂</span></div>
      <p id="status" class="kstatus"></p>
      <h2 id="caption" class="kcaption"></h2>
      <p id="meaning" class="kmeaning" hidden></p>
      <p id="you" class="kyou" hidden></p>
      <p id="notice" class="notice" hidden></p>
      <p id="error" class="error" hidden></p>
      <div class="live-row"><span id="timer">${icon(Clock, 18)} 0:00</span><span id="xp-session" class="xp-live">+0 XP</span></div>
      <button id="big" class="bigbtn" type="button"><span class="ico">${icon(Mic, 44)}</span><span class="lbl">Talk!</span></button>
      <button id="change-topic" class="kbtn ghost" type="button">Change topic</button>
    </section>

    <section id="screen-done" class="kscreen" hidden>
      <div class="confetti">🎉</div>
      <h1 class="kids-title">Great job!</h1>
      <div class="stats">
        <div class="stat"><span>${icon(Clock, 26)}</span><b id="done-time">0:00</b><small>talking</small></div>
        <div class="stat"><span>${icon(Star, 26)}</span><b id="done-xp">+0</b><small>XP</small></div>
        <div class="stat"><span>${icon(Sparkles, 26)}</span><b id="done-said">0</b><small>things you said</small></div>
      </div>
      <p id="done-level" class="levelup" hidden></p>
      <h3 class="ksub">New words you used</h3>
      <ul id="done-words" class="word-cards"></ul>
      <p id="done-hint" class="hint"></p>
      <button id="again" class="bigbtn small" type="button"><span class="ico">${icon(RotateCcw, 32)}</span><span class="lbl">Play again</span></button>
    </section>
  </div>

  <div id="overlay" class="overlay" hidden></div>
  <aside id="sheet" class="sheet" hidden aria-label="Grown-ups">
    <div class="grab"></div>
    <button id="close-settings" class="close" type="button" aria-label="Close">${icon(X, 22)}</button>
    <h2>For grown-ups</h2>
    <p class="hint">Kids mode teaches English with meanings in Spanish. Conversations are limited to 10 minutes. XP and words are saved in this browser only.</p>
    <label>Provider <select id="voice-provider"><option value="api">OpenAI API key</option><option value="codex">Codex subscription via bridge</option></select></label>
    <label id="bridge-row">Bridge URL <input id="bridge-url" type="url" placeholder="${DEFAULT_BRIDGE}" /></label>
    <label id="key-row">OpenAI API key <input id="key" type="password" autocomplete="off" placeholder="sk-…" /></label>
    <div class="row"><button id="save-key" class="btn" type="button">${icon(Check, 18)} Save key</button><span id="key-status" class="status-line"></span></div>
    <label>Meanings in <select id="meaning-language"></select></label>
    <div class="row"><button id="reset-xp" class="btn danger" type="button">Reset XP</button><a class="btn secondary" href="/">Grown-up Mural</a></div>
  </aside>`;

// ---------- Store & coordinator ----------
const store = await LearningStore.open(KIDS_KEY);
if (!store.preferences.hasOnboarded) store.updatePreferences(p => { p.learningLanguageID = 'en'; p.meaningLanguage = 'Spanish'; p.meaningVisible = true; p.sessionMinutes = 10; p.hasOnboarded = true; });
if (!LanguageRegistry.module(store.preferences.learningLanguageID) || store.preferences.learningLanguageID !== 'en') store.selectLanguage('en');
const coordinator = new Coordinator(store, $<HTMLAudioElement>('remote-audio'), 'kids');

// ---------- Settings (grown-ups) ----------
const providerSelect = $<HTMLSelectElement>('voice-provider'), bridgeInput = $<HTMLInputElement>('bridge-url'), meaningSelect = $<HTMLSelectElement>('meaning-language');
for (const m of MeaningLanguages.all) meaningSelect.add(new Option(m, m));
function openSettings(open: boolean) { $('sheet').hidden = !open; $('overlay').hidden = !open; if (open) renderSettings(); }
function renderSettings() {
  const v = loadVoiceSettings(); providerSelect.value = v.provider; bridgeInput.value = v.bridgeURL;
  $('bridge-row').hidden = v.provider !== 'codex'; $('key-row').hidden = v.provider === 'codex'; $('save-key').parentElement!.hidden = v.provider === 'codex';
  meaningSelect.value = store.preferences.meaningLanguage;
  const s = $('key-status'); s.textContent = CredentialStore.hasKey ? 'Key saved' : 'No key yet'; s.classList.toggle('ok', CredentialStore.hasKey);
}
$('open-settings').onclick = () => openSettings(true);
$('close-settings').onclick = () => openSettings(false);
$('overlay').onclick = () => openSettings(false);
providerSelect.onchange = () => { const v = loadVoiceSettings(); v.provider = providerSelect.value as 'api' | 'codex'; saveVoiceSettings(v); renderSettings(); };
bridgeInput.onchange = () => { const v = loadVoiceSettings(); v.bridgeURL = bridgeInput.value.trim() || DEFAULT_BRIDGE; saveVoiceSettings(v); };
$('save-key').onclick = () => { try { CredentialStore.save($<HTMLInputElement>('key').value); $<HTMLInputElement>('key').value = ''; } catch (e: any) { alert(e.message); } renderSettings(); };
meaningSelect.onchange = () => coordinator.selectMeaningLanguage(meaningSelect.value);
$('reset-xp').onclick = () => { if (confirm('Reset XP to zero?')) { totalXP = 0; saveXP(); renderXP(); } };

// ---------- Screens ----------
type Screen = 'pick' | 'talk' | 'done';
let screen: Screen = 'pick';
let theme: KidsTheme | undefined;
let sessionXP = 0, xpTicks = 0, saidCounted = 0, wordsCounted = new Set<string>();
let startedAt = 0, talkedMs = 0, levelBefore = level(totalXP);
let ticker: number | undefined;
let explained: Record<string, string> = {}, explaining = false;
let summarySession: ReturnType<typeof coordinator.store.session> = undefined; // frozen copy of the ended conversation; the coordinator resets its own 15 s later

function show(next: Screen) { screen = next; for (const s of ['pick', 'talk', 'done'] as Screen[]) $(`screen-${s}`).hidden = s !== next; window.scrollTo({ top: 0 }); }
function renderXP() {
  $('xp-total').textContent = String(totalXP); $('xp-level').textContent = `Level ${level(totalXP)}`;
  $('xp-fill').style.width = `${(totalXP % XP.perLevel)}%`;
}
function addXP(n: number) { if (n <= 0) return; sessionXP += n; totalXP += n; saveXP(); renderXP(); const b = $('xp-badge'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); $('xp-session').textContent = `+${sessionXP} XP`; }

function renderTopics() {
  $('topic-grid').innerHTML = kidsThemes.map(t => `<button type="button" class="topic c${t.colorIndex}" data-theme="${t.id}"><span class="emoji">${t.emoji}</span><strong>${escape(t.title)}</strong><span>${escape(t.subtitle)}</span></button>`).join('');
}
function pick(t: KidsTheme) {
  theme = t; coordinator.resetConversation(); coordinator.chooseTheme(t);
  $('talk-emoji').textContent = t.emoji; $('talk-title').textContent = t.title;
  sessionXP = 0; xpTicks = 0; saidCounted = 0; wordsCounted = new Set(); talkedMs = 0; explained = {}; explaining = false;
  $('xp-session').textContent = '+0 XP'; $('timer').innerHTML = `${icon(Clock, 18)} 0:00`;
  show('talk'); render();
}
$('topic-grid').onclick = e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-theme]')?.dataset.theme; const t = kidsThemes.find(x => x.id === id); if (t) pick(t); };
$('surprise').onclick = () => pick(randomKidsTheme());
$('change-topic').onclick = () => { if (!coordinator.isRunning) { coordinator.resetConversation(); show('pick'); } };
$('again').onclick = () => { coordinator.resetConversation(); summarySession = undefined; show('pick'); renderTopics(); };

const canStart = () => loadVoiceSettings().provider === 'codex' || CredentialStore.hasKey;
$('big').onclick = () => {
  const c = coordinator;
  if (c.state === 'active' || c.state === 'connecting') { c.end(); return; }
  if (c.isRunning) return;
  if (!canStart()) { openSettings(true); return; }
  levelBefore = level(totalXP); startedAt = Date.now(); talkedMs = 0;
  c.start();
};

function tick() {
  const c = coordinator;
  if (c.state !== 'active') return;
  talkedMs = Date.now() - startedAt;
  $('timer').innerHTML = `${icon(Clock, 18)} ${mmss(talkedMs)}`;
  const ticks = Math.floor(talkedMs / 5000);
  if (ticks > xpTicks) { addXP((ticks - xpTicks) * XP.perFiveSeconds); xpTicks = ticks; }
}

function render() {
  const c = coordinator, p = store.preferences;
  if (c.state === 'active' && !ticker) ticker = window.setInterval(tick, 1000);
  if (c.state !== 'active' && ticker) { clearInterval(ticker); ticker = undefined; }
  // XP for things said
  const said = c.passages.filter(x => x.speaker === 'user').length;
  if (said > saidCounted) { addXP((said - saidCounted) * XP.perThingSaid); saidCounted = said; }
  // XP for validated new words (live assessments and the final one)
  for (const a of c.session?.assessments ?? []) for (const w of a.words) { const key = w.lemma.toLowerCase(); if (!wordsCounted.has(key)) { wordsCounted.add(key); addXP(XP.perNewWord); } }

  const buddy = $('buddy'); buddy.dataset.state = c.state; buddy.dataset.who = c.outputLevel > c.inputLevel ? 'assistant' : 'user';
  buddy.style.setProperty('--level', Math.max(c.inputLevel, c.outputLevel).toFixed(3));
  $('buddy-face').textContent = c.state === 'connecting' ? '😮' : c.state === 'active' ? (c.outputLevel > 0.05 ? '😃' : c.inputLevel > 0.05 ? '👂' : '🙂') : c.state === 'failed' ? '😅' : '🙂';
  $('status').textContent = c.state === 'idle' ? 'Press the button and say hi!' : c.state === 'connecting' ? 'Getting ready…' : c.state === 'active' ? (c.outputLevel > 0.02 ? 'Mural is talking' : c.inputLevel > 0.02 ? 'I hear you!' : 'Your turn!') : c.state === 'closing' ? 'Saving…' : c.state === 'ended' ? 'Bye for now!' : 'Oops, let’s try again';
  $('caption').textContent = c.session ? c.caption : theme ? `Let’s talk about ${theme.title.toLowerCase()}!` : 'Hi!';
  const meaning = $('meaning'); meaning.hidden = !(p.meaningVisible && c.meaning); meaning.textContent = c.meaning;
  const you = c.userPassage; $('you').hidden = !you; if (you) $('you').innerHTML = `<b>You:</b> ${escape(passageText(you))}`;
  const notice = $('notice'); notice.hidden = !c.notice; notice.textContent = c.notice ?? '';
  const error = $('error'); error.hidden = !c.error; error.textContent = c.error ?? '';
  const big = $('big'); const active = c.state === 'active', busy = c.state === 'connecting' || c.state === 'closing';
  big.classList.toggle('stop', active || c.state === 'connecting'); big.classList.toggle('busy', busy);
  big.innerHTML = active || c.state === 'connecting' ? `<span class="ico">${icon(Square, 40)}</span><span class="lbl">Stop</span>` : `<span class="ico">${icon(Mic, 44)}</span><span class="lbl">Talk!</span>`;
  $('change-topic').hidden = c.isRunning;
  if (c.session && summarySession && c.session.id === summarySession.id) summarySession = c.session; // final assessment may update it
  if (c.state === 'ended' && screen === 'talk') showSummary();
  if (screen === 'done') renderSummary();
}

function showSummary() {
  summarySession = coordinator.session;
  show('done');
  $('done-time').textContent = mmss(talkedMs);
  $('done-said').textContent = String(saidCounted);
  const lvl = level(totalXP); const up = $('done-level'); up.hidden = lvl <= levelBefore; up.textContent = `⭐ Level up! You are now level ${lvl}!`;
  renderSummary();
}
function renderSummary() {
  $('done-xp').textContent = `+${sessionXP}`;
  const words = new Map<string, { lemma: string; meaning: string; quote: string }>();
  for (const a of summarySession?.assessments ?? []) for (const w of a.words) if (!words.has(w.lemma.toLowerCase())) words.set(w.lemma.toLowerCase(), { lemma: w.lemma, meaning: w.meaning, quote: w.quote });
  const list = [...words.values()];
  const missing = list.filter(w => !(w.lemma.toLowerCase() in explained));
  if (missing.length && !explaining) {
    explaining = true;
    coordinator.explainWords(missing, store.preferences.meaningLanguage).then(r => { explained = { ...explained, ...r }; }).catch(() => {}).finally(() => { explaining = false; renderSummary(); });
  }
  $('done-words').innerHTML = list.length ? list.map(w => `<li><b>${escape(w.lemma)}</b><span>${escape(explained[w.lemma.toLowerCase()] ?? w.meaning)}</span><small>“${escape(w.quote)}”</small></li>`).join('') : '';
  const pending = summarySession && !list.length && (Date.now() - (summarySession.endedAt ?? Date.now())) < 20_000;
  $('done-hint').textContent = list.length ? `${list.length} new word${list.length === 1 ? '' : 's'}! Use them again next time to make them stronger.` : pending ? 'Looking for your new words…' : (saidCounted ? 'Talk a little more next time to collect new words!' : 'Say something next time and you’ll collect words!');
  if (pending) setTimeout(renderSummary, 3000);
}

coordinator.onChange = render;
renderXP(); renderTopics(); show('pick'); render();
if (import.meta.env.DEV) (window as any).mural = { coordinator, store, pick, kidsThemes };
