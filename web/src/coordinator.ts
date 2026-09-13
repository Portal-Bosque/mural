// Port of App/ConversationCoordinator.swift for the browser.
import { APIClient, CredentialStore } from './api';
import { LiveTransport, type ConnectionState, type LiveEvent } from './transport';
import { LanguageRegistry, type ConversationTheme, type LanguageModule } from './core/languages';
import { type Assessment, type Passage, type SessionRecord, type WordProposal, type Outcome, appendFragment, fragment, newSession, sessionPassages, passageText, revisionKey, cloneSession } from './core/models';
import { TeachingPolicy } from './core/policy';
import { LearningEngine } from './core/engine';
import { MeaningController, meaningRequest, requestCacheKey } from './core/meaning';
import { FinalAssessmentQueue, applyFinalResult, type FinalAssessmentResult } from './core/assessment-queue';
import type { LearningStore } from './storage';
import { loadVoiceSettings } from './voice';

interface APIUsageLike { input: number; output: number; searches: number }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class Coordinator {
  state: ConnectionState = 'idle';
  session?: SessionRecord;
  selectedTheme?: ConversationTheme;
  inputLevel = 0; outputLevel = 0;
  working = false;
  error?: string; notice?: string;
  step = '';
  log: string[] = [];
  onChange?: () => void;
  readonly meanings: MeaningController;
  private readonly finalAssessments: FinalAssessmentQueue;
  private api = new APIClient();
  private transport: LiveTransport;
  private timers: { duration?: number; save?: number; assessment?: number; reset?: number; close?: number } = {};
  private lastActivity = 0;
  private lastAssessmentKey = '';
  private delegations = new Set<string>();
  private generation = 0;
  private resetDeadline?: number;

  constructor(public store: LearningStore, audio: HTMLAudioElement) {
    this.transport = new LiveTransport(audio);
    this.transport.onEvent = e => this.handle(e);
    this.transport.onLevels = (i, o) => { this.inputLevel = i; this.outputLevel = o; if (i > 0.03 || o > 0.03) this.lastActivity = Date.now(); this.onChange?.(); };
    this.transport.onFailure = m => this.fail(m);
    this.transport.onStep = s => { this.step = s; this.trace(`· ${s}`); };
    this.finalAssessments = new FinalAssessmentQueue((snapshot, passage) => Coordinator.assess(this.api, snapshot, passage));
    this.finalAssessments.onResult = result => {
      const updated = applyFinalResult(result, this.store.session(result.sessionID));
      if (!updated) return;
      this.store.save(updated);
      if (this.session?.id === updated.id) this.session = updated;
      this.trace(`final assessment applied: ${updated.assessments.at(-1)?.outcome}`);
      this.onChange?.();
    };
    this.meanings = new MeaningController(async request => {
      const language = LanguageRegistry.module(request.learningLanguageID);
      if (!language) throw new Error('Unsupported language');
      const result = await this.api.respond(TeachingPolicy.translation(language, request.meaningLanguage), request.text.slice(-2200));
      return { text: result.text, inputTokens: result.usage.input, outputTokens: result.usage.output };
    });
    this.meanings.onResult = (request, result) => {
      if (!this.session || this.session.id !== request.sessionID) return;
      this.session.translations[requestCacheKey(request)] = result.text;
      this.session.inputTokens += result.inputTokens; this.session.outputTokens += result.outputTokens;
      this.save();
    };
    this.meanings.onChange = () => this.onChange?.();
    store.onSessionInvalidation = id => this.finalAssessments.cancel(id);
    window.addEventListener('pagehide', () => { if (this.isRunning) this.end('Page closed'); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.resume(); });
  }

  get language(): LanguageModule { return this.store.language; }
  get isRunning() { return this.state === 'active' || this.state === 'connecting' || this.state === 'closing'; }
  get isMuted() { return this.transport.isMuted; }
  get passages(): Passage[] { return this.session ? sessionPassages(this.session) : []; }
  get assistantPassage() { return [...this.passages].reverse().find(p => p.speaker === 'assistant'); }
  get userPassage() { return [...this.passages].reverse().find(p => p.speaker === 'user'); }
  get caption() { const a = this.assistantPassage; return a ? passageText(a) : this.language.greeting; }
  get meaning() { return this.meanings.text; }
  get translating() { return this.meanings.isLoading; }
  get meaningError() { return this.meanings.error; }
  get status() {
    switch (this.state) {
      case 'idle': return 'Ready when you are';
      case 'connecting': return this.step ? `Getting comfortable… ${this.step}` : 'Getting comfortable…';
      case 'active': return this.outputLevel > 0.02 ? 'Mural is speaking' : this.inputLevel > 0.02 ? 'I’m listening' : 'Take your time';
      case 'closing': return 'Saving our conversation…';
      case 'ended': return 'Until next time';
      case 'failed': return 'Let’s try again';
    }
  }
  private trace(line: string) { this.log.push(`${new Date().toLocaleTimeString()} ${line}`); if (this.log.length > 200) this.log.shift(); this.onChange?.(); }

  async start() {
    if (this.isRunning) return;
    const voice = loadVoiceSettings();
    if (voice.provider === 'api' && !CredentialStore.hasKey) { this.error = 'Add your OpenAI key in Settings first.'; this.onChange?.(); return; }
    this.cancelReset(); this.meanings.reset();
    this.error = undefined; this.notice = undefined; this.lastAssessmentKey = ''; this.step = '';
    this.state = 'connecting'; this.delegations.clear();
    const record = newSession({ languageID: this.language.id, themeID: this.selectedTheme?.id, title: this.selectedTheme?.title });
    this.session = record; this.store.save(record);
    const generation = ++this.generation;
    const learner = this.store.learner;
    const prefs = this.store.preferences;
    // Each new conversation starts fresh; learned vocabulary and difficulty still carry forward.
    const instructions = TeachingPolicy.voice(this.language, learner, this.selectedTheme, prefs.interests, prefs.meaningLanguage);
    this.trace(`connecting: ${this.language.name}${this.selectedTheme ? ' / ' + this.selectedTheme.title : ''} · challenge ${learner.challenge} · ${learner.words.length} words known · provider ${voice.provider === 'codex' ? 'codex subscription (' + voice.model + ' + gpt-5.6-luna via bridge)' : 'API key (gpt-live-1 + gpt-5.6-luna)'}`);
    this.onChange?.();
    try { await this.transport.connect(this.api, instructions, [], voice); }
    catch (e: any) {
      if (e?.name === 'AbortError') return;
      if (generation === this.generation && this.session?.id === record.id && (this.state === 'connecting' || this.state === 'active')) this.fail(e?.message ?? String(e));
    }
  }
  selectLanguage(id: string) {
    if (this.isRunning || id === this.language.id || !LanguageRegistry.module(id)) return;
    this.cancelReset(); this.generation++;
    this.clearTimers(); this.meanings.reset();
    this.session = undefined; this.selectedTheme = undefined;
    this.working = false; this.notice = undefined; this.error = undefined; this.lastAssessmentKey = '';
    this.inputLevel = 0; this.outputLevel = 0; this.state = 'idle';
    this.store.selectLanguage(id); this.onChange?.();
  }
  selectMeaningLanguage(value: string) {
    this.meanings.reset();
    this.store.updatePreferences(p => { p.meaningLanguage = value; });
    this.scheduleTranslation();
  }
  chooseTheme(theme?: ConversationTheme) {
    if (!this.isRunning && this.session) this.resetConversation();
    this.selectedTheme = theme;
    if (this.state === 'active' && this.session) {
      this.session.themeID = theme?.id; this.session.title = theme?.title ?? `A little ${this.language.name}`;
      this.append('instructions', TeachingPolicy.theme(theme, this.language));
      this.save();
    }
    this.onChange?.();
  }
  toggleMute() { if (this.state !== 'active') return; this.transport.mute(!this.transport.isMuted); this.onChange?.(); }
  toggleMeaning() {
    this.store.updatePreferences(p => { p.meaningVisible = !p.meaningVisible; });
    if (this.store.preferences.meaningVisible) this.scheduleTranslation(); else this.meanings.reset();
    this.onChange?.();
  }
  retryMeaning() { this.scheduleTranslation(); this.meanings.retry(); }
  help() { if (this.state !== 'active') return; this.append('instructions', TeachingPolicy.help(this.language)); this.notice = 'Mural will make that a little simpler.'; this.onChange?.(); }
  end(reason = 'Ended by you') {
    if (this.state !== 'active' && this.state !== 'connecting') return;
    const wasConnecting = this.state === 'connecting';
    this.state = 'closing'; this.trace(`ending: ${reason}`);
    this.clearTimer('assessment'); this.clearTimer('duration'); this.working = false; this.delegations.clear();
    if (this.session) this.session.endReason = reason;
    this.onChange?.();
    if (wasConnecting) { this.finish(false); return; }
    this.transport.close();
    this.timers.close = window.setTimeout(() => { if (this.state === 'closing') this.finish(false); }, 5000);
  }
  deleteLearningData() {
    if (this.isRunning) return;
    this.meanings.reset(); this.clearTimers(); this.resetConversation(); this.store.deleteAll();
  }
  private finish(final: boolean) {
    if (!this.isRunning) return;
    this.clearTimers();
    this.transport.disconnect(); this.working = false; this.delegations.clear();
    if (this.session) { this.session.endedAt = Date.now(); this.session.usageFinal = final; }
    this.save(); this.state = 'ended';
    if (this.session) this.finalAssessments.submit(this.session);
    this.scheduleTranslation(); this.scheduleReset();
    if (!final && this.session?.providerID) this.notice = 'Conversation saved. Final voice usage is unconfirmed.';
    this.onChange?.();
  }
  private fail(message: string) { this.error = message; if (this.session) this.session.endReason = 'Connection failed'; this.trace(`failed: ${message}`); this.finish(false); this.cancelReset(); this.state = 'failed'; this.onChange?.(); }
  private save() { if (this.session) this.store.save(this.session); }
  private scheduleSave() { if (this.timers.save) return; this.timers.save = window.setTimeout(() => { this.timers.save = undefined; this.save(); }, 750); }
  private clearTimer(name: keyof typeof this.timers) { const t = this.timers[name]; if (t) { clearTimeout(t); clearInterval(t); this.timers[name] = undefined; } }
  private clearTimers() { for (const k of Object.keys(this.timers) as (keyof typeof this.timers)[]) this.clearTimer(k); }

  private append(kind: string, text: string, delegationID?: string): boolean {
    if (this.state !== 'active') return false;
    // Bound short instruction updates conservatively below the protocol token cap.
    const ok = this.transport.send({ type: `session.${kind}.append`, event_id: crypto.randomUUID(), delegation_id: delegationID ?? null, content: text.slice(0, 1000) });
    if (!ok) { this.notice = 'A conversation update couldn’t be sent. You can keep speaking.'; this.onChange?.(); }
    return ok;
  }
  private handle(event: LiveEvent) {
    const type = event.type;
    if (!this.session) return;
    if (!type.endsWith('transcript.delta')) this.trace(`← ${type}${type === 'error' ? ' ' + JSON.stringify(event.error ?? event) : ''}`);
    switch (type) {
      case 'mural.session.created': this.session.providerID = event.session?.id; this.session.voiceSeconds = 15; this.save(); break;
      case 'session.started':
        if (this.state !== 'connecting') return;
        this.state = 'active'; this.lastActivity = Date.now();
        this.session.providerID = event.session?.id ?? this.session.providerID;
        this.append('instructions', TeachingPolicy.greeting(this.language));
        this.startDurationChecks(); this.save(); break;
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta': {
        if (this.state !== 'active' && this.state !== 'closing') return;
        const { delta, start_ms: start, end_ms: end } = event;
        if (typeof delta !== 'string' || typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < start) return;
        const speaker = type === 'session.input_transcript.delta' ? 'user' : 'assistant';
        const f = fragment({ id: typeof event.event_id === 'string' ? event.event_id : undefined, speaker, text: delta, startMS: start, endMS: end, meaningVisible: this.store.preferences.meaningVisible });
        appendFragment(this.session, f); this.lastActivity = Date.now(); this.scheduleSave();
        if (speaker === 'assistant') this.scheduleTranslation();
        else if (this.state === 'active') this.scheduleAssessment();
        break;
      }
      case 'session.delegation.created': {
        const d = event.delegation;
        if (this.state === 'active' && d?.target === 'client' && typeof d.id === 'string') this.delegate(d.id);
        break;
      }
      case 'session.usage.updated':
      case 'session.closed': {
        const seconds = event.usage?.seconds;
        if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) this.session.voiceSeconds = seconds;
        if (type === 'session.closed') { this.session.endReason = event.reason ?? this.session.endReason; this.finish(true); } else this.scheduleSave();
        break;
      }
      case 'error': this.notice = 'A voice update was rejected. If Mural stops responding, end this conversation and start again.'; break;
    }
    this.onChange?.();
  }
  private startDurationChecks() {
    this.clearTimer('duration');
    this.timers.duration = window.setInterval(() => {
      if (this.state !== 'active' || !this.session) return;
      if (Date.now() - this.session.startedAt > this.store.preferences.sessionMinutes * 60_000) { this.notice = 'You’ve reached your conversation time limit.'; this.end('Time limit'); }
      else if (Date.now() - this.lastActivity > 120_000) { this.notice = 'Mural ended this quiet session to avoid running up usage.'; this.end('Inactivity'); }
    }, 5000);
  }
  private scheduleTranslation() {
    const passage = this.assistantPassage;
    if (!this.store.preferences.meaningVisible || !this.session || !passage) return;
    const request = meaningRequest(this.session.id, passage, this.session.languageID, this.store.preferences.meaningLanguage);
    this.meanings.update(request, this.session.translations[requestCacheKey(request)]);
  }
  resetConversation() {
    if (this.isRunning) return;
    this.cancelReset(); this.meanings.reset(); this.clearTimer('save');
    this.generation++;
    this.session = undefined; this.selectedTheme = undefined;
    this.notice = undefined; this.error = undefined; this.working = false;
    this.inputLevel = 0; this.outputLevel = 0; this.state = 'idle';
    this.onChange?.();
  }
  private cancelReset() { this.clearTimer('reset'); this.resetDeadline = undefined; }
  private scheduleReset() {
    this.cancelReset();
    const id = this.session?.id; if (!id) return;
    this.resetDeadline = Date.now() + 15_000;
    this.timers.reset = window.setTimeout(() => { if (this.state === 'ended' && this.session?.id === id) this.resetConversation(); }, 15_000);
  }
  resume() { if (this.state === 'ended' && this.resetDeadline && Date.now() >= this.resetDeadline) this.resetConversation(); }

  private static async assess(api: APIClient, snapshot: SessionRecord, passage: Passage): Promise<FinalAssessmentResult> {
    const language = LanguageRegistry.module(snapshot.languageID);
    if (!language) throw new Error('Unsupported language');
    const result = await api.respond(TeachingPolicy.assessment(language), TeachingPolicy.context(snapshot, passage), { schema: APIClient.assessmentSchema(language) });
    const decoded = JSON.parse(result.text) as { outcome: Outcome; suggestedLevel: number; nextGoal: string; capability: string; words: WordProposal[] };
    const assessment: Assessment = { passageID: passage.id, revisionKey: revisionKey(passage), outcome: decoded.outcome, suggestedLevel: decoded.suggestedLevel,
      nextGoal: decoded.nextGoal, capability: decoded.capability, words: decoded.words, createdAt: Date.now(), context: snapshot.themeID ?? 'free' };
    return { sessionID: snapshot.id, languageID: snapshot.languageID, assessment, inputTokens: result.usage.input, outputTokens: result.usage.output, searchCalls: result.usage.searches };
  }
  private scheduleAssessment() {
    this.clearTimer('assessment');
    this.timers.assessment = window.setTimeout(async () => {
      this.timers.assessment = undefined;
      const snapshot = this.session && cloneSession(this.session);
      const p = snapshot && [...sessionPassages(snapshot)].reverse().find(x => x.speaker === 'user');
      if (!snapshot || !p || passageText(p).length < 3 || revisionKey(p) === this.lastAssessmentKey || this.state !== 'active') return;
      const targetLanguage = LanguageRegistry.module(snapshot.languageID); if (!targetLanguage) return;
      const generation = this.generation;
      try {
        const result = await Coordinator.assess(this.api, snapshot, p);
        const current = this.session;
        if (generation !== this.generation || this.state !== 'active' || !current || current.id !== snapshot.id) return;
        const live = this.userPassage; if (!live || revisionKey(live) !== revisionKey(p)) return;
        const validated = LearningEngine.validate(result.assessment, current);
        if (!validated) { this.trace('assessment discarded by validation'); return; }
        current.assessments = current.assessments.filter(a => a.passageID !== p.id); current.assessments.push(validated);
        this.lastAssessmentKey = revisionKey(p);
        this.addUsage({ input: result.inputTokens, output: result.outputTokens, searches: result.searchCalls }); this.save();
        const learner = this.store.learner;
        this.trace(`assessment: ${validated.outcome} · level ${validated.suggestedLevel} · ${validated.words.length} words · challenge now ${learner.challenge}`);
        const due = learner.words.filter(w => w.dueAt < Date.now()).slice(0, 3).map(w => w.lemma).join(', ');
        this.append('thinking', `Teaching context, not spoken text: challenge ${learner.challenge}/5 in ${targetLanguage.name}. Next goal: ${learner.nextGoal}. Revisit naturally: ${due}.`);
      } catch (e: any) {
        // The passage remains saved without unverified learning evidence. Assessment status does not belong in the conversation interface.
        this.trace(`assessment failed: ${e?.message ?? e}`);
      }
      this.onChange?.();
    }, 3000);
  }
  private addUsage(u: APIUsageLike) { if (!this.session) return; this.session.inputTokens += u.input; this.session.outputTokens += u.output; this.session.searchCalls += u.searches; }
  private async delegate(id: string) {
    if (this.delegations.has(id) || !this.session) return;
    const snapshotID = this.session.id;
    this.delegations.add(id); this.working = true; this.onChange?.();
    try {
      // Transcript delivery may lag the delegation metadata slightly.
      await sleep(500);
      const current = this.session;
      if (!current || current.id !== snapshotID || this.state !== 'active') return;
      const targetLanguage = LanguageRegistry.module(current.languageID); if (!targetLanguage) return;
      const result = await this.api.respond(TeachingPolicy.delegation(targetLanguage), TeachingPolicy.context(current), { search: current.searchCalls < 3 });
      if (this.session?.id !== snapshotID || this.state !== 'active') return;
      this.addUsage(result.usage);
      if (result.sources.length) this.session.topics.push({ id: crypto.randomUUID().toUpperCase(), languageID: targetLanguage.id, query: 'From our conversation', text: result.text, sources: result.sources, retrievedAt: Date.now() });
      this.trace(`delegation ${id}: ${result.text.slice(0, 80)}… (${result.sources.length} sources)`);
      this.append('commentary', result.text, id); this.save();
    } catch (e: any) {
      if (this.session?.id !== snapshotID || this.state !== 'active') return;
      this.append('commentary', this.language.lookupUnavailableReply, id);
      this.notice = 'The lookup wasn’t completed.'; this.trace(`delegation failed: ${e?.message ?? e}`);
    } finally { this.delegations.delete(id); this.working = this.delegations.size > 0; this.onChange?.(); }
  }
  async lookup(word: string, sentence: string): Promise<string> {
    const generation = this.generation, sessionID = this.session?.id;
    const result = await this.api.respond(TeachingPolicy.lookup(this.language, this.store.preferences.meaningLanguage), `Selected: ${word}\nSentence: ${sentence}`);
    if (generation !== this.generation) throw new DOMException('cancelled', 'AbortError');
    if (this.session?.id === sessionID) { this.addUsage(result.usage); this.scheduleSave(); }
    return result.text;
  }
}
