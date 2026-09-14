// Port of App/APIClient.swift on top of fetch. The key lives only in the browser's storage for this origin.
import { safeURL } from './core/models';
import type { LanguageModule } from './core/languages';
import { loadVoiceSettings } from './voice';
export { safeURL };
export interface APIUsage { input: number; output: number; searches: number }
export interface SourceLink { title: string; url: string }
export interface APIResult { text: string; sources: SourceLink[]; usage: APIUsage }

export class APIError extends Error {
  constructor(public kind: 'missingKey' | 'invalidResponse' | 'incomplete' | 'refused' | 'http' | 'bridge', public status = 0) {
    super(APIError.describe(kind, status)); this.name = 'APIError';
  }
  static describe(kind: string, status: number) {
    switch (kind) {
      case 'missingKey': return 'Add your OpenAI key in Settings to begin.';
      case 'invalidResponse': case 'incomplete': return 'OpenAI returned an incomplete response. Please try again.';
      case 'refused': return 'Eco couldn’t complete that request. Try a different topic.';
      case 'bridge': return 'The Codex bridge didn’t answer. Start it with `npm run bridge` in web/ and check the URL in Settings.';
    }
    if (status === 401) return 'Your OpenAI key wasn’t accepted. Check it in Settings.';
    if (status === 403 || status === 404) return 'This API key may not have access to the requested model. Check your OpenAI project.';
    if (status === 429) return 'OpenAI’s usage or rate limit was reached. Check your project’s billing and limits.';
    return `OpenAI couldn’t complete the request (HTTP ${status}). Please try again.`;
  }
}

const KEY = 'mural.openai-key';
export const CredentialStore = {
  read(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } },
  get hasKey() { return !!this.read(); },
  save(raw: string) {
    const value = raw.trim();
    if (!value.startsWith('sk-') || value.length < 20 || /\s/.test(value)) throw new Error('Enter a valid OpenAI API key.');
    localStorage.setItem(KEY, value);
  },
  delete() { localStorage.removeItem(KEY); },
};

export class APIClient {
  async post(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
    const voice = loadVoiceSettings();
    if (voice.provider === 'codex' && path === 'responses') {
      // Text requests ride the Codex subscription through the local bridge, which assembles the streamed response.
      const response = await fetch(voice.bridgeURL.replace(/\/$/, '') + '/codex/responses', {
        method: 'POST', signal: signal ?? AbortSignal.timeout(120_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).catch(() => { throw new APIError('bridge'); });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); const err = new APIError('bridge'); err.message += ` (${detail?.error ?? response.status})`; throw err; }
      return response.json().catch(() => { throw new APIError('invalidResponse'); });
    }
    const key = CredentialStore.read();
    if (!key) throw new APIError('missingKey');
    const response = await fetch('https://api.openai.com/v1/' + path, {
      method: 'POST', redirect: 'error', signal: signal ?? AbortSignal.timeout(45_000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) { await response.body?.cancel(); throw new APIError('http', response.status); }
    const json = await response.json().catch(() => { throw new APIError('invalidResponse'); });
    if (!json || typeof json !== 'object') throw new APIError('invalidResponse');
    return json;
  }
  async respond(instructions: string, input: string, options: { schema?: unknown; search?: boolean } = {}): Promise<APIResult> {
    const body: Record<string, unknown> = {
      model: 'gpt-5.6-luna', store: false, instructions, input: [{ role: 'user', content: input }],
      max_output_tokens: options.schema ? 2200 : 1400, reasoning: { effort: 'low' },
    };
    if (options.schema) body.text = { format: { type: 'json_schema', name: 'mural_result', strict: true, schema: options.schema } };
    if (options.search) { body.tools = [{ type: 'web_search' }]; body.tool_choice = 'auto'; body.max_tool_calls = 1; }
    const json = await this.post('responses', body);
    if (json.status !== 'completed') throw new APIError('incomplete');
    let text = ''; const sources: SourceLink[] = []; const usage: APIUsage = { input: 0, output: 0, searches: 0 };
    for (const item of json.output ?? []) {
      if (item.type === 'web_search_call') usage.searches++;
      for (const content of item.content ?? []) {
        if (content.type === 'refusal') throw new APIError('refused');
        if (content.type === 'output_text') text += content.text ?? '';
        for (const c of content.annotations ?? []) {
          if (c.type !== 'url_citation' || typeof c.url !== 'string') continue;
          if (safeURL(c.url) && !sources.some(s => s.url === c.url)) sources.push({ title: c.title ?? 'Source', url: c.url });
        }
      }
    }
    if (json.usage) { usage.input = json.usage.input_tokens ?? 0; usage.output = json.usage.output_tokens ?? 0; }
    if (!text) throw new APIError('incomplete');
    return { text, sources, usage };
  }
  static object(fields: Record<string, unknown>) { return { type: 'object', properties: fields, required: Object.keys(fields).sort(), additionalProperties: false }; }
  static string = { type: 'string' };
  static assessmentSchema(language: LanguageModule) {
    const s = APIClient.string;
    return APIClient.object({
      outcome: { type: 'string', enum: ['success', 'partial', 'breakdown', 'uncertain'] },
      suggestedLevel: { type: 'integer', minimum: 0, maximum: 5 }, nextGoal: s, capability: s,
      words: { type: 'array', maxItems: 12, items: APIClient.object({
        lemma: s, meaning: s, form: s, quote: s, language: { type: 'string', enum: [...new Set([language.id, 'en', 'mixed', 'uncertain'])].sort() },
        kind: { type: 'string', enum: ['exposure', 'understanding', 'assisted', 'independent', 'lapse'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 }, sourceIDs: { type: 'array', items: s },
      }) },
    });
  }
}
