// Port of Tests/LearningTests.swift
import { describe, it, expect } from 'vitest';
import { Archive, ArchiveError, appendFragment, correctFragment, fragment, newSession, passages, passageText, sessionPassages, revisionKey, safeURL, type SessionRecord, type EvidenceKind, type Assessment } from '../src/core/models';
import { LearningEngine } from '../src/core/engine';
import { norwegian, themesFor } from '../src/core/languages';

const DAY = 86_400_000;
function fixture({ day = 0, theme = 'walk', supported = false, kind = 'independent' as EvidenceKind } = {}): SessionRecord {
  const date = 1_780_000_000_000 + day * DAY;
  const s = newSession({ themeID: theme }); s.startedAt = date;
  appendFragment(s, fragment({ speaker: 'user', text: 'Jeg gikk i skogen.', startMS: 1000, endMS: 2000, receivedAt: date, meaningVisible: supported }));
  const p = sessionPassages(s)[0];
  s.assessments = [{ passageID: p.id, revisionKey: revisionKey(p), outcome: 'success', suggestedLevel: 2, nextGoal: 'Fortell mer.', capability: 'Describes a past outing',
    words: [{ lemma: 'å gå', meaning: 'to go', form: 'gikk', kind, confidence: 0.95, sourceIDs: p.fragments.map(f => f.id), quote: 'Jeg gikk i skogen.', language: 'nb' }],
    createdAt: date, context: theme }];
  return s;
}

describe('transcript', () => {
  it('duplicate provider events do not change the transcript', () => {
    const s = newSession(); const f = fragment({ id: 'same', speaker: 'user', text: 'Hei', startMS: 0, endMS: 100 });
    appendFragment(s, f); appendFragment(s, f);
    expect(s.fragments).toHaveLength(1);
  });
  it('concatenation preserves exact provider whitespace', () => {
    const f = [fragment({ id: 'a', speaker: 'assistant', text: 'Hva', startMS: 0, endMS: 100 }), fragment({ id: 'b', speaker: 'assistant', text: ' gjorde du?', startMS: 100, endMS: 400 })];
    expect(passageText(passages(f)[0])).toBe('Hva gjorde du?');
  });
  it('late fragments rebuild the earlier passage and invalidate evidence', () => {
    const s = fixture();
    appendFragment(s, fragment({ id: 'late', speaker: 'user', text: ' kanskje', startMS: 2100, endMS: 2500 }));
    expect(s.assessments).toHaveLength(0); expect(sessionPassages(s)).toHaveLength(1);
  });
  it('overlapping speakers remain separate', () => {
    const p = passages([fragment({ speaker: 'assistant', text: 'Hei', startMS: 0, endMS: 500 }), fragment({ speaker: 'user', text: 'Hallo', startMS: 100, endMS: 400 }), fragment({ speaker: 'assistant', text: '!', startMS: 500, endMS: 600 })]);
    expect(p).toHaveLength(2); expect(passageText(p[0])).toBe('Hei!'); expect(passageText(p[1])).toBe('Hallo');
  });
});

describe('evidence validation', () => {
  it('visible meaning cannot award independent recall', () => {
    const s = fixture({ supported: true });
    expect(LearningEngine.validate(s.assessments[0], s)?.words[0].kind).toBe('assisted');
    expect(LearningEngine.project([s]).words[0].independentCount).toBe(0);
  });
  it('immediate imitation is assisted', () => {
    const s = fixture(); s.fragments.unshift(fragment({ speaker: 'assistant', text: 'Du gikk en tur?', startMS: 0, endMS: 500 }));
    expect(LearningEngine.validate(s.assessments[0], s)?.words[0].kind).toBe('assisted');
  });
  it('english cannot award norwegian production', () => {
    const s = fixture(); s.assessments[0].words[0].language = 'en';
    expect(LearningEngine.validate(s.assessments[0], s)?.words).toHaveLength(0);
  });
  it('typing cannot award independent spoken recall', () => {
    const s = fixture(); s.fragments[0].typed = true;
    expect(LearningEngine.validate(s.assessments[0], s)?.words[0].kind).toBe('assisted');
  });
  it('fabricated sources and quotes are rejected', () => {
    let s = fixture(); s.assessments[0].words[0].sourceIDs = ['invented'];
    expect(LearningEngine.validate(s.assessments[0], s)?.words).toHaveLength(0);
    s = fixture(); s.assessments[0].words[0].quote = 'Jeg kan fly.';
    expect(LearningEngine.validate(s.assessments[0], s)?.words).toHaveLength(0);
  });
  it('corrected transcript revokes evidence', () => {
    const s = fixture(); correctFragment(s, s.fragments[0].id, 'I went for a walk.');
    expect(s.assessments).toHaveLength(0); expect(LearningEngine.project([s]).words).toHaveLength(0);
  });
});

describe('projection', () => {
  it('duplicate assessments never double credit', () => {
    const s = fixture(); s.assessments = [...s.assessments, ...s.assessments];
    const p = LearningEngine.project([s], 'nb', [], s.startedAt);
    expect(p.words[0].independentCount).toBe(1); expect(p.observationCount).toBe(1);
  });
  it('duplicate word proposals never double credit', () => {
    const s = fixture(); s.assessments[0].words = [...s.assessments[0].words, ...s.assessments[0].words];
    expect(LearningEngine.project([s], 'nb', [], s.startedAt).words[0].independentCount).toBe(1);
  });
  it('steady requires spacing and different contexts', () => {
    const first = fixture(), second = fixture({ day: 2 }), third = fixture({ day: 8, theme: 'dinner' });
    expect(LearningEngine.project([first, second, third], 'nb', [], third.startedAt).words[0].bars).toBe(3);
    expect(LearningEngine.project([first, second, fixture({ day: 8 })], 'nb', [], third.startedAt).words[0].bars).toBe(2);
    expect(LearningEngine.project([first, fixture({ day: 0.01 }), fixture({ day: 0.02 })], 'nb', [], first.startedAt).words[0].bars).toBeLessThanOrEqual(2);
  });
  it('strength fades and lapses lower it', () => {
    const sessions = [fixture(), fixture({ day: 2 }), fixture({ day: 8, theme: 'dinner' })];
    expect(LearningEngine.project(sessions, 'nb', [], sessions[2].startedAt + 30 * DAY).words[0].bars).toBe(2);
    const lapse = fixture({ day: 9, kind: 'lapse' });
    expect(LearningEngine.project([...sessions, lapse], 'nb', [], lapse.startedAt).words[0].bars).toBe(1);
  });
  it('hidden words are excluded and level moves after two successes', () => {
    const a = fixture(), b = fixture({ day: 1 });
    const p = LearningEngine.project([a, b], 'nb', [], b.startedAt);
    expect(p.challenge).toBe(1); expect(p.observationCount).toBe(2);
    expect(LearningEngine.project([a, b], 'nb', ['nb|å gå|to go'], b.startedAt).words).toHaveLength(0);
  });
});

describe('archive', () => {
  it('round trips and guards the version', () => {
    const archive = { schemaVersion: 2, sessions: [fixture()], preferences: Archive.decode(Archive.encode({ schemaVersion: 2, sessions: [], preferences: newPrefs() })).preferences };
    const decoded = Archive.decode(Archive.encode(archive));
    expect(decoded.sessions).toHaveLength(1);
    expect(decoded.sessions[0].startedAt).toBe(archive.sessions[0].startedAt);
    expect(decoded.sessions[0].assessments[0].words[0].lemma).toBe('å gå');
    expect(() => Archive.decode(Archive.encode({ ...archive, schemaVersion: 99 }))).toThrow(ArchiveError);
  });
  it('encodes dates like the iOS app (seconds since 2001) with sorted keys', () => {
    const s = fixture(); const wire = JSON.parse(Archive.encode({ schemaVersion: 2, sessions: [s], preferences: newPrefs() }));
    expect(wire.sessions[0].startedAt).toBeCloseTo((s.startedAt - Date.UTC(2001, 0, 1)) / 1000, 3);
    expect(Object.keys(wire)).toEqual(['preferences', 'schemaVersion', 'sessions']);
    expect(wire.sessions[0].endedAt).toBeUndefined();
  });
  it('migrates version 1 archives to norwegian', () => {
    const v1 = { schemaVersion: 1, preferences: { meaningVisible: true, meaningLanguage: 'English', sessionMinutes: 15, hiddenWords: ['hei|hi'], interests: '', hasOnboarded: true },
      sessions: [{ id: 'A', startedAt: 0, title: 'x', fragments: [], assessments: [], translations: {}, topics: [{ id: 'T', query: 'q', text: 't', sources: [], retrievedAt: 0 }], voiceSeconds: 0, usageFinal: false, inputTokens: 0, outputTokens: 0, searchCalls: 0 }] };
    const a = Archive.decode(JSON.stringify(v1));
    expect(a.preferences.learningLanguageID).toBe('nb'); expect(a.preferences.hiddenWords).toEqual(['nb|hei|hi']);
    expect(a.sessions[0].languageID).toBe('nb'); expect(a.sessions[0].topics[0].languageID).toBe('nb');
  });
  it('rejects duplicate session imports', () => {
    const s = fixture();
    expect(() => Archive.decode(Archive.encode({ schemaVersion: 2, sessions: [s, s], preferences: newPrefs() }))).toThrow(ArchiveError);
  });
  it('rejects numbers that can crash the interface', () => {
    const bad = (mutate: (s: SessionRecord) => void) => { const s = fixture(); mutate(s); return () => Archive.decode(Archive.encode({ schemaVersion: 2, sessions: [s], preferences: newPrefs() })); };
    expect(bad(s => { s.voiceSeconds = 1e308; })).toThrow(ArchiveError);
    expect(bad(s => { s.searchCalls = Number.MAX_SAFE_INTEGER; })).toThrow(ArchiveError);
    expect(bad(s => { s.fragments[0].revision = Number.MAX_SAFE_INTEGER; })).toThrow(ArchiveError);
    expect(bad(s => { s.inputTokens = -1; })).toThrow(ArchiveError);
    expect(bad(s => { s.assessments[0].createdAt = 1e308; })).toThrow(ArchiveError);
  });
  it('import merge cannot persist an archive that fails on relaunch', () => {
    const original = { schemaVersion: 2, sessions: Array.from({ length: 10_000 }, () => newSession()), preferences: newPrefs() };
    const incoming = { schemaVersion: 2, sessions: [newSession()], preferences: newPrefs() };
    expect(() => Archive.merging(original, incoming)).toThrow(/too large/);
    expect(original.sessions).toHaveLength(10_000);
    incoming.sessions = [original.sessions[0]];
    expect(Archive.merging(original, incoming).sessions).toHaveLength(10_000);
    const big = (c: string) => ({ schemaVersion: 2, sessions: [newSession({ title: c.repeat(15_000_000) })], preferences: newPrefs() });
    const a = big('a'), b = big('b');
    expect(() => Archive.decode(Archive.encode(a))).not.toThrow();
    expect(() => Archive.merging(a, b)).toThrow(/too large/);
  });
  it('import merge preserves local preferences and validates new evidence', () => {
    const original = { schemaVersion: 2, sessions: [] as SessionRecord[], preferences: { ...newPrefs(), meaningLanguage: 'Spanish', aiConsentVersion: 1 } };
    const invalid = fixture(); invalid.assessments[0].revisionKey = 'changed';
    const merged = Archive.merging(original, { schemaVersion: 2, sessions: [invalid], preferences: { ...newPrefs(), meaningLanguage: 'English' } });
    expect(merged.preferences.meaningLanguage).toBe('Spanish'); expect(merged.preferences.aiConsentVersion).toBe(1);
    expect(merged.sessions[0].assessments).toHaveLength(0);
    expect(Archive.decode(Archive.encode(merged)).sessions).toHaveLength(1);
  });
  it('source links reject non-https and credentials', () => {
    expect(safeURL('javascript:alert(1)')).toBeNull(); expect(safeURL('https://user@example.com/page')).toBeNull(); expect(safeURL('https://www.nrk.no/')).not.toBeNull();
  });
  it('has twenty-four distinct themes', () => { expect(new Set(themesFor(norwegian).map(t => t.id)).size).toBe(24); });
});

function newPrefs() { return { learningLanguageID: 'nb', meaningVisible: true, meaningLanguage: 'English', sessionMinutes: 15, hiddenWords: [], interests: '', hasOnboarded: false }; }
