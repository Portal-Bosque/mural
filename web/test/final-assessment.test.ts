// Port of Tests/FinalAssessmentTests.swift
import { describe, it, expect } from 'vitest';
import { FinalAssessmentQueue, applyFinalResult, type FinalAssessmentResult } from '../src/core/assessment-queue';
import { appendFragment, correctFragment, fragment, newSession, passageText, revisionKey, type Passage, type SessionRecord } from '../src/core/models';

class Provider {
  pending: { session: SessionRecord; passage: Passage; resolve: (r: FinalAssessmentResult) => void }[] = [];
  assess = (session: SessionRecord, passage: Passage) => new Promise<FinalAssessmentResult>(resolve => this.pending.push({ session, passage, resolve }));
  finish() {
    const { session, passage, resolve } = this.pending.shift()!;
    resolve({ sessionID: session.id, languageID: session.languageID, inputTokens: 100, outputTokens: 20, searchCalls: 0,
      assessment: { passageID: passage.id, revisionKey: revisionKey(passage), outcome: 'success', suggestedLevel: 1, nextGoal: 'Una pregunta más.', capability: 'Names an object', createdAt: Date.now(), context: 'free',
        words: [{ lemma: 'la radio', meaning: 'radio', form: 'radio', kind: 'independent', confidence: 0.95, sourceIDs: passage.fragments.map(f => f.id), quote: passageText(passage), language: session.languageID }] } });
  }
}
const ended = (languageID = 'es') => { const s = newSession({ languageID }); appendFragment(s, fragment({ speaker: 'user', text: 'radio', startMS: 0, endMS: 1000 })); s.endedAt = Date.now(); return s; };
async function waitUntil(condition: () => boolean) {
  const limit = Date.now() + 1000;
  while (!condition() && Date.now() < limit) await new Promise(r => setTimeout(r, 1));
  expect(condition()).toBe(true);
}

describe('FinalAssessmentQueue', () => {
  it('reset and a new language do not redirect results to the new session', async () => {
    const old = ended(), fresh = ended('fr'), provider = new Provider();
    const records = new Map([[old.id, old], [fresh.id, fresh]]); let visible: SessionRecord | undefined = old;
    const queue = new FinalAssessmentQueue(provider.assess);
    queue.onResult = result => { const updated = applyFinalResult(result, records.get(result.sessionID)); if (updated) records.set(updated.id, updated); if (visible?.id === result.sessionID) visible = records.get(result.sessionID); };
    expect(queue.submit(old)).toBe(true); await waitUntil(() => provider.pending.length === 1);
    visible = undefined; visible = fresh;
    provider.finish(); await waitUntil(() => !queue.isPending(old.id));
    expect(records.get(old.id)!.assessments).toHaveLength(1); expect(records.get(old.id)!.inputTokens).toBe(100);
    expect(records.get(fresh.id)!.assessments).toHaveLength(0); expect(visible!.id).toBe(fresh.id); expect(visible!.assessments).toHaveLength(0);
  });
  it('a deleted session is never recreated by a late result', async () => {
    const session = ended(), provider = new Provider(); const records = new Map([[session.id, session]]);
    const queue = new FinalAssessmentQueue(provider.assess);
    queue.onResult = result => { const updated = applyFinalResult(result, records.get(result.sessionID)); if (updated) records.set(updated.id, updated); };
    queue.submit(session); await waitUntil(() => provider.pending.length === 1);
    records.delete(session.id); provider.finish(); await waitUntil(() => !queue.isPending(session.id));
    expect(records.size).toBe(0);
  });
  it('cancellation and the deadline reject responses that ignore cancellation', async () => {
    for (const explicitlyCancel of [true, false]) {
      const session = ended(), provider = new Provider(); let received = 0;
      const queue = new FinalAssessmentQueue(provider.assess, 30); queue.onResult = () => { received++; };
      queue.submit(session); await waitUntil(() => provider.pending.length === 1);
      if (explicitlyCancel) queue.cancel(session.id);
      await waitUntil(() => !queue.isPending(session.id));
      provider.finish(); await new Promise(r => setTimeout(r, 5));
      expect(received).toBe(0);
    }
  });
  it('a corrected transcript rejects the original assessment', async () => {
    const session = ended(), provider = new Provider(), queue = new FinalAssessmentQueue(provider.assess); let applied = false;
    queue.onResult = result => { applied = applyFinalResult(result, session) !== undefined; };
    queue.submit(session); await waitUntil(() => provider.pending.length === 1);
    correctFragment(session, session.fragments[0].id, 'televisión');
    provider.finish(); await waitUntil(() => !queue.isPending(session.id));
    expect(applied).toBe(false);
  });
  it('already assessed and pending passages do not start duplicate requests', async () => {
    let session = ended(); const provider = new Provider(), queue = new FinalAssessmentQueue(provider.assess);
    queue.onResult = result => { session = applyFinalResult(result, session)!; };
    expect(queue.submit(session)).toBe(true); expect(queue.submit(session)).toBe(false);
    await waitUntil(() => provider.pending.length === 1); provider.finish(); await waitUntil(() => !queue.isPending(session.id));
    expect(queue.submit(session)).toBe(false); expect(session.assessments).toHaveLength(1); expect(session.outputTokens).toBe(20);
  });
});
