// Port of Core/MeaningController.swift. Keeps one translation in flight while coalescing growing transcript fragments.
import { type Passage, passageText, revisionKey } from './models';

export interface MeaningRequest {
  sessionID: string; passageID: string; revisionKey: string; text: string; learningLanguageID: string; meaningLanguage: string;
}
export function meaningRequest(sessionID: string, passage: Passage, learningLanguageID: string, meaningLanguage: string): MeaningRequest {
  return { sessionID, passageID: passage.id, revisionKey: revisionKey(passage), text: passageText(passage), learningLanguageID, meaningLanguage };
}
export const meaningCacheKey = (rk: string, language: string) => language + '::' + rk;
export const requestCacheKey = (r: MeaningRequest) => meaningCacheKey(r.revisionKey, r.meaningLanguage);
const sameRequest = (a: MeaningRequest, b: MeaningRequest) =>
  a.sessionID === b.sessionID && a.passageID === b.passageID && a.revisionKey === b.revisionKey && a.text === b.text &&
  a.learningLanguageID === b.learningLanguageID && a.meaningLanguage === b.meaningLanguage;
const sharesContext = (a: MeaningRequest, b: MeaningRequest) =>
  a.sessionID === b.sessionID && a.passageID === b.passageID && a.learningLanguageID === b.learningLanguageID && a.meaningLanguage === b.meaningLanguage;

export interface MeaningResult { text: string; inputTokens: number; outputTokens: number }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class MeaningController {
  text = '';
  isLoading = false;
  error?: string;
  onResult?: (request: MeaningRequest, result: MeaningResult) => void;
  onChange?: () => void;
  private desired?: MeaningRequest;
  private rendered?: MeaningRequest;
  private working = false;
  private generation = 0;

  constructor(private translate: (request: MeaningRequest) => Promise<MeaningResult>, private delay = 450) {}

  update(request: MeaningRequest, cached?: string) {
    const changedContext = this.desired ? !sharesContext(this.desired, request) : true;
    if (changedContext) this.reset();
    this.desired = request;
    if (cached) { this.cancelWorker(); this.text = cached; this.rendered = request; this.error = undefined; this.onChange?.(); return; }
    if (this.rendered && sameRequest(this.rendered, request)) return;
    // Do not display a translation of text that was subsequently corrected.
    if (this.rendered && !request.text.startsWith(this.rendered.text)) { this.text = ''; this.rendered = undefined; }
    if (!this.working && !this.error) this.begin();
    this.onChange?.();
  }
  reset() { this.cancelWorker(); this.desired = undefined; this.rendered = undefined; this.text = ''; this.error = undefined; this.onChange?.(); }
  retry() { if (!this.desired) return; this.cancelWorker(); this.error = undefined; this.begin(); }
  private cancelWorker() { this.generation++; this.working = false; this.isLoading = false; }
  private begin() {
    if (!this.desired || this.working) return;
    this.working = true; this.isLoading = true; this.onChange?.();
    const token = this.generation;
    (async () => {
      try {
        await sleep(this.delay);
        if (token !== this.generation || !this.desired) return;
        const request = this.desired;
        const result = await this.translate(request);
        if (token !== this.generation || !this.desired) return;
        const latest = this.desired;
        if (!result.text.trim()) throw new Error('The translation came back empty. Please try again.');
        this.onResult?.(request, result);
        if (sharesContext(latest, request) && latest.text.startsWith(request.text)) { this.text = result.text; this.rendered = request; }
        this.working = false; this.isLoading = false;
        if (!sameRequest(latest, request)) this.begin();
        this.onChange?.();
      } catch (e: any) {
        if (token !== this.generation) return;
        this.working = false; this.isLoading = false;
        this.error = e?.message ?? String(e);
        this.onChange?.();
      }
    })();
  }
}
