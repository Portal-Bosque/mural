// Port of Core/Models.swift. Plain objects plus functions so records serialise and clone trivially.
// Dates are epoch milliseconds in memory; the archive wire format matches the iOS app (seconds since 2001-01-01),
// so a backup exported from the iPhone imports here and vice versa.
import { LanguageRegistry, defaultTitle } from './languages';

export type Speaker = 'user' | 'assistant';
export type EvidenceKind = 'exposure' | 'understanding' | 'assisted' | 'independent' | 'lapse';
export type Outcome = 'success' | 'partial' | 'breakdown' | 'uncertain';

export const uuid = () => crypto.randomUUID().toUpperCase();

export interface Fragment {
  id: string; revision: number; previousTexts: string[]; speaker: Speaker; text: string;
  startMS: number; endMS: number; receivedAt: number; meaningVisible: boolean; typed: boolean;
}
export function fragment(f: Partial<Fragment> & Pick<Fragment, 'speaker' | 'text' | 'startMS' | 'endMS'>): Fragment {
  return { id: f.id ?? uuid(), revision: f.revision ?? 0, previousTexts: f.previousTexts ?? [], speaker: f.speaker, text: f.text,
    startMS: f.startMS, endMS: f.endMS, receivedAt: f.receivedAt ?? Date.now(), meaningVisible: f.meaningVisible ?? false, typed: f.typed ?? false };
}

export interface Passage { id: string; speaker: Speaker; fragments: Fragment[] }
export const passageText = (p: Passage) => p.fragments.map(f => f.text).join('');
export const passageStart = (p: Passage) => p.fragments[0]?.startMS ?? 0;
export const passageEnd = (p: Passage) => p.fragments.length ? Math.max(...p.fragments.map(f => f.endMS)) : 0;
export const revisionKey = (p: Passage) => p.fragments.map(f => `${f.id}:${f.revision}`).join(',');

/** Presentation grouping only: neither the gap nor the arrival of another speaker proves a completed turn. */
export function passages(fragments: Fragment[]): Passage[] {
  const result: Passage[] = [];
  const indexed = fragments.map((f, i) => ({ f, i })).sort((a, b) => a.f.startMS === b.f.startMS ? a.i - b.i : a.f.startMS - b.f.startMS);
  for (const { f } of indexed) {
    let last: Passage | undefined;
    for (let k = result.length - 1; k >= 0; k--) if (result[k].speaker === f.speaker) { last = result[k]; break; }
    if (last && f.startMS - passageEnd(last) <= 2200 && !f.typed && !(last.fragments.at(-1)?.typed ?? false)) last.fragments.push(f);
    else result.push({ id: f.id, speaker: f.speaker, fragments: [f] });
  }
  return result.sort((a, b) => passageStart(a) - passageStart(b));
}

export interface WordProposal {
  lemma: string; meaning: string; form: string; kind: EvidenceKind; confidence: number; sourceIDs: string[]; quote: string; language: string;
}
export const wordKey = (w: WordProposal) => w.language + '|' + w.lemma.trim().toLowerCase() + '|' + w.meaning.toLowerCase();

export interface Assessment {
  passageID: string; revisionKey: string; outcome: Outcome; suggestedLevel: number; nextGoal: string; capability: string;
  words: WordProposal[]; createdAt: number; context: string;
}

export interface SourceLink { title: string; url: string }
export function safeURL(url: string): URL | null {
  try { const u = new URL(url); return u.protocol === 'https:' && !!u.hostname && !u.username ? u : null; } catch { return null; }
}

export interface TopicBrief { id: string; languageID: string; query: string; text: string; sources: SourceLink[]; retrievedAt: number }
export const topicBrief = (languageID: string, query: string, text: string, sources: SourceLink[]): TopicBrief =>
  ({ id: uuid(), languageID, query, text, sources, retrievedAt: Date.now() });
export const isFresh = (t: TopicBrief) => Date.now() - t.retrievedAt < 6 * 3600_000;

export interface SessionRecord {
  id: string; languageID: string; providerID?: string; startedAt: number; endedAt?: number; themeID?: string; title: string;
  fragments: Fragment[]; assessments: Assessment[]; translations: Record<string, string>; topics: TopicBrief[];
  voiceSeconds: number; usageFinal: boolean; inputTokens: number; outputTokens: number; searchCalls: number; endReason?: string;
}
export function newSession(options: { languageID?: string; themeID?: string; title?: string } = {}): SessionRecord {
  const languageID = options.languageID ?? LanguageRegistry.defaultID;
  const module = LanguageRegistry.module(languageID);
  return { id: uuid(), languageID, startedAt: Date.now(), themeID: options.themeID,
    title: options.title ?? (module ? defaultTitle(module) : 'A conversation'),
    fragments: [], assessments: [], translations: {}, topics: [], voiceSeconds: 0, usageFinal: false, inputTokens: 0, outputTokens: 0, searchCalls: 0 };
}
export const sessionPassages = (s: SessionRecord) => passages(s.fragments);
export function appendFragment(s: SessionRecord, f: Fragment): boolean {
  if (s.fragments.some(x => x.id === f.id)) return false;
  s.fragments.push(f); invalidateChangedAssessments(s); return true;
}
export function invalidateChangedAssessments(s: SessionRecord) {
  const current = new Map(sessionPassages(s).map(p => [p.id, revisionKey(p)]));
  s.assessments = s.assessments.filter(a => current.get(a.passageID) === a.revisionKey);
}
export function correctFragment(s: SessionRecord, id: string, text: string) {
  const f = s.fragments.find(x => x.id === id);
  if (!f) return;
  f.previousTexts.push(f.text); f.text = text; f.revision += 1;
  s.translations = {}; invalidateChangedAssessments(s);
}
export const cloneSession = (s: SessionRecord): SessionRecord => JSON.parse(JSON.stringify(s));

export interface Preferences {
  learningLanguageID: string; meaningVisible: boolean; meaningLanguage: string; sessionMinutes: number;
  hiddenWords: string[]; interests: string; hasOnboarded: boolean; aiConsentVersion?: number;
}
export const newPreferences = (): Preferences => ({ learningLanguageID: LanguageRegistry.defaultID, meaningVisible: true, meaningLanguage: 'English',
  sessionMinutes: 15, hiddenWords: [], interests: '', hasOnboarded: false });

export interface Archive { schemaVersion: number; sessions: SessionRecord[]; preferences: Preferences }
export const newArchive = (): Archive => ({ schemaVersion: 2, sessions: [], preferences: newPreferences() });

export class ArchiveError extends Error {
  constructor(public kind: 'tooLarge' | 'unsupportedVersion' | 'unsupportedLanguage' | 'invalid') {
    super({
      tooLarge: 'This backup is too large to import.',
      unsupportedVersion: 'This backup needs a newer version of Eco.',
      unsupportedLanguage: 'This backup contains a language module that this version of Eco does not support.',
      invalid: 'This backup has invalid or duplicate records.',
    }[kind]); this.name = 'ArchiveError';
  }
}

export const MAXIMUM_ENCODED_BYTES = 30_000_000;
const MAXIMUM_SESSIONS = 10_000;
const REFERENCE_DATE_MS = Date.UTC(2001, 0, 1);
const toWireDate = (ms: number) => (ms - REFERENCE_DATE_MS) / 1000;
const fromWireDate = (s: unknown) => typeof s === 'number' ? s * 1000 + REFERENCE_DATE_MS : NaN;
const validDate = (ms: number) => Number.isFinite(ms) && Math.abs(ms) <= 8.64e15;
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const inRange = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  return value;
}
const dropUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const Archive = {
  encode(archive: Archive): string {
    const wire = {
      schemaVersion: archive.schemaVersion,
      preferences: dropUndefined({ ...archive.preferences }),
      sessions: archive.sessions.map(s => dropUndefined({
        ...s, startedAt: toWireDate(s.startedAt), endedAt: s.endedAt === undefined ? undefined : toWireDate(s.endedAt),
        fragments: s.fragments.map(f => ({ ...f, receivedAt: toWireDate(f.receivedAt) })),
        assessments: s.assessments.map(a => ({ ...a, createdAt: toWireDate(a.createdAt) })),
        topics: s.topics.map(t => ({ ...t, retrievedAt: toWireDate(t.retrievedAt) })),
      })),
    };
    return JSON.stringify(sortKeys(wire), null, 2);
  },
  decode(data: string): Archive {
    if (byteLength(data) > MAXIMUM_ENCODED_BYTES) throw new ArchiveError('tooLarge');
    let root: any;
    try { root = JSON.parse(data); } catch { throw new ArchiveError('invalid'); }
    root = migrate(root);
    const archive = fromWire(root);
    validate(archive);
    return archive;
  },
  /** Reject the complete candidate before changing local history, so it remains readable on relaunch. */
  merging(current: Archive, incoming: Archive): Archive {
    validate(incoming);
    const known = new Set(current.sessions.map(s => s.id));
    const additions = incoming.sessions.filter(s => !known.has(s.id));
    if (additions.length > MAXIMUM_SESSIONS - current.sessions.length) throw new ArchiveError('tooLarge');
    const candidate: Archive = { schemaVersion: current.schemaVersion, preferences: { ...current.preferences }, sessions: current.sessions.map(cloneSession) };
    for (const original of additions) {
      const session = cloneSession(original);
      invalidateChangedAssessments(session);
      session.assessments = session.assessments.map(a => validateAssessment(a, session)).filter((a): a is Assessment => !!a);
      candidate.sessions.push(session);
    }
    validate(candidate);
    if (byteLength(Archive.encode(candidate)) > MAXIMUM_ENCODED_BYTES) throw new ArchiveError('tooLarge');
    return candidate;
  },
};

// LearningEngine.validate is needed by merging; it lives in engine.ts and registers itself here to avoid a cycle.
let validateAssessment: (a: Assessment, s: SessionRecord) => Assessment | undefined = a => a;
export function registerAssessmentValidator(fn: typeof validateAssessment) { validateAssessment = fn; }

function fromWire(root: any): Archive {
  if (!root || typeof root !== 'object' || !root.preferences || !Array.isArray(root.sessions)) throw new ArchiveError('invalid');
  const p = root.preferences;
  const preferences: Preferences = {
    learningLanguageID: str(p.learningLanguageID), meaningVisible: !!p.meaningVisible, meaningLanguage: str(p.meaningLanguage),
    sessionMinutes: p.sessionMinutes, hiddenWords: strs(p.hiddenWords), interests: str(p.interests), hasOnboarded: !!p.hasOnboarded,
    aiConsentVersion: isInt(p.aiConsentVersion) ? p.aiConsentVersion : undefined,
  };
  const sessions: SessionRecord[] = root.sessions.map((s: any) => {
    if (!s || typeof s !== 'object') throw new ArchiveError('invalid');
    return dropUndefined({
      id: str(s.id), languageID: str(s.languageID), providerID: s.providerID == null ? undefined : str(s.providerID),
      startedAt: fromWireDate(s.startedAt), endedAt: s.endedAt == null ? undefined : fromWireDate(s.endedAt),
      themeID: s.themeID == null ? undefined : str(s.themeID), title: str(s.title),
      fragments: arr(s.fragments).map((f: any) => ({ id: str(f.id), revision: f.revision ?? 0, previousTexts: strs(f.previousTexts), speaker: f.speaker, text: str(f.text),
        startMS: f.startMS, endMS: f.endMS, receivedAt: fromWireDate(f.receivedAt), meaningVisible: !!f.meaningVisible, typed: !!f.typed })),
      assessments: arr(s.assessments).map((a: any) => ({ passageID: str(a.passageID), revisionKey: str(a.revisionKey), outcome: a.outcome, suggestedLevel: a.suggestedLevel,
        nextGoal: str(a.nextGoal), capability: str(a.capability), createdAt: fromWireDate(a.createdAt), context: str(a.context ?? 'free'),
        words: arr(a.words).map((w: any) => ({ lemma: str(w.lemma), meaning: str(w.meaning), form: str(w.form), kind: w.kind, confidence: w.confidence,
          sourceIDs: strs(w.sourceIDs), quote: str(w.quote), language: str(w.language ?? LanguageRegistry.defaultID) })) })),
      translations: s.translations && typeof s.translations === 'object' ? { ...s.translations } : {},
      topics: arr(s.topics).map((t: any) => ({ id: str(t.id), languageID: str(t.languageID), query: str(t.query), text: str(t.text),
        sources: arr(t.sources).map((l: any) => ({ title: str(l.title), url: str(l.url) })), retrievedAt: fromWireDate(t.retrievedAt) })),
      voiceSeconds: s.voiceSeconds, usageFinal: !!s.usageFinal, inputTokens: s.inputTokens, outputTokens: s.outputTokens, searchCalls: s.searchCalls,
      endReason: s.endReason == null ? undefined : str(s.endReason),
    }) as SessionRecord;
  });
  return { schemaVersion: root.schemaVersion, sessions, preferences };
}
const str = (v: unknown) => { if (typeof v !== 'string') throw new ArchiveError('invalid'); return v; };
const arr = (v: unknown) => { if (v === undefined) return []; if (!Array.isArray(v)) throw new ArchiveError('invalid'); return v; };
const strs = (v: unknown) => arr(v).map(str);

function validate(archive: Archive) {
  if (!LanguageRegistry.module(archive.preferences.learningLanguageID)) throw new ArchiveError('unsupportedLanguage');
  const p = archive.preferences;
  if (new Set(archive.sessions.map(s => s.id)).size !== archive.sessions.length || archive.sessions.length > MAXIMUM_SESSIONS ||
      !isInt(p.sessionMinutes) || p.sessionMinutes < 1 || p.sessionMinutes > 60) throw new ArchiveError('invalid');
  const speakers = new Set(['user', 'assistant']), outcomes = new Set(['success', 'partial', 'breakdown', 'uncertain']),
    kinds = new Set(['exposure', 'understanding', 'assisted', 'independent', 'lapse']);
  for (const s of archive.sessions) {
    if (!LanguageRegistry.module(s.languageID)) throw new ArchiveError('unsupportedLanguage');
    // These generous limits exceed a normal session while keeping UI conversions and totals safe.
    if (!inRange(s.voiceSeconds, 0, 31_536_000) || ![s.inputTokens, s.outputTokens, s.searchCalls].every(n => isInt(n) && n >= 0 && n <= 1_000_000_000) ||
        !validDate(s.startedAt) || (s.endedAt !== undefined && !validDate(s.endedAt)) ||
        !s.assessments.every(a => validDate(a.createdAt) && outcomes.has(a.outcome) && isInt(a.suggestedLevel) &&
          a.words.every(w => kinds.has(w.kind) && typeof w.confidence === 'number'))) throw new ArchiveError('invalid');
    if (new Set(s.fragments.map(f => f.id)).size !== s.fragments.length ||
        !s.fragments.every(f => speakers.has(f.speaker) && isInt(f.startMS) && f.startMS >= 0 && isInt(f.endMS) && f.endMS >= f.startMS && f.text.length <= 50_000 &&
          isInt(f.revision) && f.revision >= 0 && f.revision <= 1_000_000 && validDate(f.receivedAt)) ||
        !s.topics.every(t => t.languageID === s.languageID && validDate(t.retrievedAt))) throw new ArchiveError('invalid');
  }
}

/** Version 1 was Norwegian-only. Migration assigns that provenance once; version 2 records must explicitly declare their language. */
function migrate(root: any): any {
  if (!root || typeof root !== 'object' || !isInt(root.schemaVersion)) throw new ArchiveError('invalid');
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) throw new ArchiveError('unsupportedVersion');
  if (root.schemaVersion === 2) return root;
  if (!root.preferences || typeof root.preferences !== 'object' || !Array.isArray(root.sessions)) throw new ArchiveError('invalid');
  const id = LanguageRegistry.defaultID;
  const preferences = { ...root.preferences, learningLanguageID: id };
  if (Array.isArray(preferences.hiddenWords)) preferences.hiddenWords = preferences.hiddenWords.map((h: string) => id + '|' + h);
  const sessions = root.sessions.map((s: any) => ({ ...s, languageID: id,
    topics: Array.isArray(s.topics) ? s.topics.map((t: any) => ({ ...t, languageID: id })) : s.topics }));
  return { ...root, schemaVersion: 2, preferences, sessions };
}
