// Port of Core/FinalAssessmentQueue.swift. Finishes the latest unassessed user passage without owning the visible conversation.
import { LearningEngine } from './engine';
import { type Assessment, type Passage, type SessionRecord, passageText, revisionKey, sessionPassages, cloneSession } from './models';

export interface FinalAssessmentResult {
  sessionID: string; languageID: string; assessment: Assessment; inputTokens: number; outputTokens: number; searchCalls: number;
}
/** Apply only to the original saved transcript, which may have changed or been deleted. */
export function applyFinalResult(result: FinalAssessmentResult, current: SessionRecord | undefined): SessionRecord | undefined {
  if (!current || current.id !== result.sessionID || current.languageID !== result.languageID || current.endedAt === undefined) return undefined;
  const validated = LearningEngine.validate(result.assessment, current);
  if (!validated) return undefined;
  if (current.assessments.some(a => a.passageID === result.assessment.passageID && a.revisionKey === result.assessment.revisionKey)) return undefined;
  const updated = cloneSession(current);
  updated.assessments = updated.assessments.filter(a => a.passageID !== validated.passageID);
  updated.assessments.push(validated);
  updated.inputTokens += result.inputTokens; updated.outputTokens += result.outputTokens; updated.searchCalls += result.searchCalls;
  return updated;
}

export class FinalAssessmentQueue {
  onResult?: (result: FinalAssessmentResult) => void;
  private jobs = new Map<string, { token: number; deadline: number; timer: ReturnType<typeof setTimeout> }>();
  private counter = 0;
  private readonly timeout: number;
  constructor(private assess: (session: SessionRecord, passage: Passage) => Promise<FinalAssessmentResult>, timeoutMs = 15_000) {
    this.timeout = Math.min(15_000, Math.max(1, timeoutMs));
  }
  submit(session: SessionRecord): boolean {
    if (session.endedAt === undefined || this.jobs.has(session.id)) return false;
    // Work on a snapshot: a later correction of the live record must not change the passage already in flight.
    const snapshot = cloneSession(session);
    const passage = [...sessionPassages(snapshot)].reverse().find(p => p.speaker === 'user');
    if (!passage || passageText(passage).length < 3) return false;
    const rk = revisionKey(passage);
    if (snapshot.assessments.some(a => a.passageID === passage.id && a.revisionKey === rk)) return false;
    const token = ++this.counter, deadline = Date.now() + this.timeout;
    const timer = setTimeout(() => { if (this.jobs.get(session.id)?.token === token) this.cancel(session.id); }, this.timeout);
    this.jobs.set(session.id, { token, deadline, timer });
    this.assess(snapshot, passage).then(result => {
      const job = this.jobs.get(session.id);
      if (!job || job.token !== token || Date.now() > job.deadline || result.sessionID !== session.id || result.languageID !== session.languageID) return;
      clearTimeout(job.timer); this.jobs.delete(session.id);
      this.onResult?.(result);
    }, () => {
      const job = this.jobs.get(session.id);
      if (job?.token === token) { clearTimeout(job.timer); this.jobs.delete(session.id); }
    });
    return true;
  }
  isPending(id: string) { return this.jobs.has(id); }
  cancel(id: string) { const job = this.jobs.get(id); if (!job) return; clearTimeout(job.timer); this.jobs.delete(id); }
}
