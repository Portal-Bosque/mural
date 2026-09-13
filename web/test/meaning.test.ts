// Port of Tests/MeaningTests.swift
import { describe, it, expect } from 'vitest';
import { MeaningController, meaningRequest, requestCacheKey, type MeaningRequest, type MeaningResult } from '../src/core/meaning';
import { fragment } from '../src/core/models';

class Translator {
  requests: MeaningRequest[] = [];
  pending: { resolve: (r: MeaningResult) => void; reject: (e: Error) => void }[] = [];
  translate = (request: MeaningRequest) => { this.requests.push(request); return new Promise<MeaningResult>((resolve, reject) => this.pending.push({ resolve, reject })); };
  succeed(text: string) { this.pending.shift()!.resolve({ text, inputTokens: 0, outputTokens: 0 }); }
  fail() { this.pending.shift()!.reject(new Error('offline')); }
}
const sessionID = 'S';
const request = (text: string, { revision = 0, language = 'English', passageID = 'p' } = {}) => {
  const f = fragment({ id: passageID, speaker: 'assistant', text, startMS: 0, endMS: 1000, revision });
  return meaningRequest(sessionID, { id: passageID, speaker: 'assistant', fragments: [f] }, 'nb', language);
};
async function waitUntil(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition() && Date.now() < deadline) await new Promise(r => setTimeout(r, 1));
  expect(condition()).toBe(true);
}

describe('MeaningController', () => {
  it('growing speech coalesces without cancelling the running translation', async () => {
    const t = new Translator(); const c = new MeaningController(t.translate, 0);
    c.update(request('Hei')); await waitUntil(() => t.requests.length === 1);
    c.update(request('Hei,', { revision: 1 })); c.update(request('Hei, jeg', { revision: 2 })); c.update(request('Hei, jeg liker kaffe.', { revision: 3 }));
    expect(t.requests).toHaveLength(1);
    t.succeed('Hi'); await waitUntil(() => t.requests.length === 2);
    expect(c.text).toBe('Hi'); expect(c.isLoading).toBe(true); expect(t.requests[1].text).toBe('Hei, jeg liker kaffe.');
    t.succeed('Hi, I like coffee.'); await waitUntil(() => !c.isLoading);
    expect(c.text).toBe('Hi, I like coffee.'); expect(c.error).toBeUndefined();
  });
  it('continuous fragments do not keep restarting the delay', async () => {
    const t = new Translator(); const c = new MeaningController(t.translate, 30);
    for (let r = 0; r < 12; r++) { c.update(request('hei '.repeat(r + 1), { revision: r })); await new Promise(x => setTimeout(x, 10)); }
    expect(t.requests).toHaveLength(1); expect(t.requests[0].text.length).toBeLessThan(48);
    c.reset(); if (t.pending.length) t.succeed('Hello');
  });
  it('hiding meaning rejects late results and can show a cached translation', async () => {
    const t = new Translator(); const c = new MeaningController(t.translate, 0); let saved = 0; c.onResult = () => { saved++; };
    c.update(request('Hei')); await waitUntil(() => t.requests.length === 1);
    c.reset(); c.update(request('Hei'), 'Hi'); t.fail(); await new Promise(r => setTimeout(r, 10));
    expect(c.text).toBe('Hi'); expect(c.error).toBeUndefined(); expect(c.isLoading).toBe(false); expect(saved).toBe(0); expect(t.requests).toHaveLength(1);
  });
  it('a new passage rejects the previous passage’s response', async () => {
    const t = new Translator(); const c = new MeaningController(t.translate, 0);
    c.update(request('Hei')); await waitUntil(() => t.requests.length === 1);
    c.update(request('Ha det', { passageID: 'next' })); await waitUntil(() => t.requests.length === 2);
    t.succeed('Hi'); await new Promise(r => setTimeout(r, 10));
    expect(c.text).toBe(''); expect(c.isLoading).toBe(true);
    t.succeed('Goodbye'); await waitUntil(() => !c.isLoading); expect(c.text).toBe('Goodbye');
  });
  it('a corrected transcript never displays the meaning of the old words', async () => {
    const t = new Translator(); const c = new MeaningController(t.translate, 0);
    c.update(request('Jeg liker kaffe.')); await waitUntil(() => t.requests.length === 1);
    c.update(request('Jeg liker te.', { revision: 1 })); t.succeed('I like coffee.'); await waitUntil(() => t.requests.length === 2);
    expect(c.text).toBe(''); t.succeed('I like tea.'); await waitUntil(() => !c.isLoading); expect(c.text).toBe('I like tea.');
  });
  it('failure is visible and retries only when requested', async () => {
    const t = new Translator(); const c = new MeaningController(t.translate, 0);
    c.update(request('Hei')); await waitUntil(() => t.requests.length === 1);
    t.fail(); await waitUntil(() => c.error !== undefined);
    c.update(request('Hei!', { revision: 1 })); expect(t.requests).toHaveLength(1); expect(c.isLoading).toBe(false);
    c.retry(); await waitUntil(() => t.requests.length === 2); expect(c.error).toBeUndefined(); expect(t.requests[1].text).toBe('Hei!');
    t.succeed('Hi!'); await waitUntil(() => !c.isLoading); expect(c.text).toBe('Hi!');
  });
  it('changing meaning language clears old text and uses separate cache keys', async () => {
    const t = new Translator(); const c = new MeaningController(t.translate, 0);
    const english = request('Hei'), french = request('Hei', { language: 'French' });
    expect(requestCacheKey(english)).not.toBe(requestCacheKey(french));
    c.update(english, 'Hi'); c.update(french); expect(c.text).toBe('');
    await waitUntil(() => t.requests.length === 1); expect(t.requests[0].meaningLanguage).toBe('French');
    t.succeed('Salut'); await waitUntil(() => !c.isLoading); expect(c.text).toBe('Salut');
  });
});
