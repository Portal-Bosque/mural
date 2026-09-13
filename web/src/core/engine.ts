// Port of Core/LearningEngine.swift.
import { LanguageRegistry } from './languages';
import { type Assessment, type SessionRecord, type WordProposal, passageText, passageStart, passageEnd, revisionKey, sessionPassages, wordKey, registerAssessmentValidator } from './models';

export interface WordState {
  id: string; lemma: string; meaning: string; form: string; example: string; bars: number;
  understandingCount: number; independentCount: number; lastSeen: number; dueAt: number;
}
export const wordLabel = (w: WordState) => ['New', 'Fragile', 'Growing', 'Steady'][Math.min(3, Math.max(0, w.bars))];
export function wordExplanation(w: WordState) {
  if (w.independentCount === 0) return 'Heard or used with support. Try using it in your own words.';
  if (w.bars === 1) return 'Used independently. We’ll bring it back soon.';
  if (w.bars === 2) return 'Recalled on different days. Still worth revisiting.';
  return 'Recalled across days and contexts. Strength can fade with time.';
}

export interface LearnerState { challenge: number; observationCount: number; nextGoal: string; capabilities: string[]; words: WordState[] }
export const levelLabel = (l: LearnerState) => l.observationCount < 4 ? 'Getting to know you' : 'Finding your pace';

const contains = (haystack: string, needle: string) => haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 86_400_000;

export const LearningEngine = {
  validate(proposal: Assessment, session: SessionRecord): Assessment | undefined {
    if (!LanguageRegistry.module(session.languageID)) return undefined;
    const passage = sessionPassages(session).find(p => p.id === proposal.passageID && p.speaker === 'user');
    if (!passage || revisionKey(passage) !== proposal.revisionKey) return undefined;
    if (!Number.isInteger(proposal.suggestedLevel) || proposal.suggestedLevel < 0 || proposal.suggestedLevel > 5 || proposal.words.length > 12) return undefined;
    const allowed = new Set(passage.fragments.map(f => f.id));
    const text = passageText(passage);
    const validated: Assessment = { ...proposal, nextGoal: proposal.nextGoal.slice(0, 300), capability: proposal.capability.slice(0, 160), words: [] };
    validated.words = proposal.words.flatMap((word): WordProposal[] => {
      if (word.language !== session.languageID || word.sourceIDs.length === 0 || !word.sourceIDs.every(id => allowed.has(id)) ||
          !Number.isFinite(word.confidence) || word.confidence < 0.8 || word.confidence > 1 ||
          !word.lemma || word.lemma.length >= 100 || !word.meaning || word.meaning.length >= 180 || !word.form || !word.quote ||
          !contains(text, word.quote) || !contains(word.quote, word.form)) return [];
      const refs = passage.fragments.filter(f => word.sourceIDs.includes(f.id)).map(f => f.text).join('');
      if (!contains(refs, word.quote)) return [];
      const result = { ...word };
      if (result.kind === 'independent') {
        // A visible meaning or immediate imitation is supporting evidence, never independent recall.
        const start = passageStart(passage);
        const recentlyModeled = sessionPassages(session).some(p => p.speaker === 'assistant' && passageStart(p) <= start && start - passageEnd(p) < 90_000 && contains(passageText(p), word.form));
        if (passage.fragments.some(f => f.meaningVisible || f.typed) || recentlyModeled) result.kind = 'assisted';
      }
      return [result];
    });
    return validated;
  },

  project(sessions: SessionRecord[], languageID: string = LanguageRegistry.defaultID, hiddenWords: string[] = [], now: number = Date.now()): LearnerState {
    let level = 0, count = 0, successes = 0;
    let nextGoal = 'Start with a greeting and one small question. Adjust from what the learner actually says.';
    const capabilityEvidence = new Map<string, Set<string>>();
    const events = new Map<string, { word: WordProposal; at: number; context: string }[]>();
    const hidden = new Set(hiddenWords);
    for (const session of sessions.filter(s => s.languageID === languageID).sort((a, b) => a.startedAt - b.startedAt)) {
      const seen = new Set<string>();
      for (const raw of [...session.assessments].sort((a, b) => a.createdAt - b.createdAt)) {
        if (seen.has(raw.passageID)) continue;
        seen.add(raw.passageID);
        const a = LearningEngine.validate(raw, session);
        if (!a) continue;
        count += 1;
        if (a.outcome === 'breakdown') { level = Math.max(0, level - 1); successes = 0; }
        else if (a.outcome === 'success') {
          successes += 1;
          if (successes >= 2) { level = Math.min(5, Math.max(level, Math.min(level + 1, a.suggestedLevel))); successes = 0; }
        } else successes = 0;
        if (a.nextGoal) nextGoal = a.nextGoal;
        if (a.outcome === 'success' && a.capability) {
          if (!capabilityEvidence.has(a.capability)) capabilityEvidence.set(a.capability, new Set());
          capabilityEvidence.get(a.capability)!.add(`${startOfDay(a.createdAt)}|${a.context}`);
        }
        const seenWords = new Set<string>();
        for (const word of a.words) {
          const key = wordKey(word);
          if (hidden.has(key) || seenWords.has(key)) continue;
          seenWords.add(key);
          if (!events.has(key)) events.set(key, []);
          events.get(key)!.push({ word, at: a.createdAt, context: a.context });
        }
      }
    }
    const words: WordState[] = [];
    for (const [key, observations] of events) {
      const last = observations.at(-1);
      if (!last) continue;
      const independent = observations.filter(o => o.word.kind === 'independent');
      const days = new Set(independent.map(o => startOfDay(o.at))).size;
      const contexts = new Set(independent.map(o => o.context)).size;
      const lastRecall = independent.at(-1)?.at;
      let bars = independent.length === 0 ? 0 : 1;
      if (days >= 2) bars = 2;
      if (days >= 3 && contexts >= 2 && independent.at(-1)!.at - independent[0].at >= 7 * DAY) bars = 3;
      const interval = [1, 1, 4, 14][bars] * DAY;
      const due = (lastRecall ?? last.at) + interval;
      if (now > due && bars > 1) bars -= 1;
      const lapse = [...observations].reverse().find(o => o.word.kind === 'lapse');
      if (lapse && lapse.at > (lastRecall ?? -Infinity)) bars = Math.min(bars, 1);
      words.push({ id: key, lemma: last.word.lemma, meaning: last.word.meaning, form: last.word.form, example: last.word.quote, bars,
        understandingCount: observations.filter(o => o.word.kind === 'understanding').length, independentCount: independent.length, lastSeen: last.at, dueAt: due });
    }
    words.sort((a, b) => b.lastSeen - a.lastSeen);
    const capabilities = [...capabilityEvidence.entries()].filter(([, v]) => v.size >= 3).map(([k]) => k).sort();
    return { challenge: level, observationCount: count, nextGoal, capabilities, words };
  },
};
registerAssessmentValidator(LearningEngine.validate);
