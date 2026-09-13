// Mural voice bridge: brokers gpt-live-1-codex realtime sessions through `codex app-server`, so the browser can use the
// ChatGPT/Codex subscription instead of an API key. The browser keeps talking WebRTC directly to OpenAI; only signalling
// and the sideband events pass through here. Node ≥ 22, no dependencies.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? '127.0.0.1';
const MODEL = process.env.MURAL_LIVE_MODEL ?? 'gpt-live-1-codex';
const ALLOWED_ORIGINS = (process.env.MURAL_ORIGINS ?? 'http://localhost:5173,https://mural-web-delta.vercel.app').split(',');
const V3_VOICES = new Set(['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove']);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- app-server client ----------
class AppServer {
  constructor() { this.id = 0; this.pending = new Map(); this.listeners = new Set(); this.buf = ''; this.ready = this.boot(); }
  async boot() {
    this.child = spawn('codex', ['app-server', '--listen', 'stdio://', '-c', 'features.realtime_conversation=true', '-c', 'suppress_unstable_features_warning=true'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', d => { const s = String(d); if (/ERROR|WARN/.test(s)) process.stderr.write('[codex] ' + s.replace(/\x1b\[[0-9;]*m/g, '')); });
    this.child.on('exit', code => { log('codex app-server exited', code); process.exit(1); });
    this.child.stdout.on('data', d => this.feed(String(d)));
    const init = await this.request('initialize', { clientInfo: { name: 'mural-bridge', title: 'Mural voice bridge', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    this.notify('initialized', {});
    const auth = await this.request('getAuthStatus', { includeToken: false, refreshToken: false });
    log(`codex app-server ready (${init.userAgent}); auth=${auth.authMethod}`);
    if (auth.authMethod !== 'chatgpt') log('WARNING: codex is not logged in with ChatGPT; run `codex login`');
  }
  feed(chunk) {
    this.buf += chunk; let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message ?? JSON.stringify(msg.error)}`)) : p.resolve(msg.result);
      } else if (msg.method && msg.id !== undefined) {
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported by mural-bridge' } }) + '\n');
      } else if (msg.method) for (const l of this.listeners) l(msg.method, msg.params ?? {});
    }
  }
  request(method, params) {
    return new Promise((resolve, reject) => { const id = ++this.id; this.pending.set(id, { resolve, reject, method }); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  notify(method, params) { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
const codex = new AppServer();

// ---------- sessions ----------
const sessions = new Map(); // realtimeSessionId → { threadId, sinks:Set<res>, backlog:[] }
codex.on((method, params) => {
  if (!method.startsWith('thread/realtime/') || method === 'thread/realtime/outputAudio/delta') return;
  const s = [...sessions.values()].find(x => x.threadId === params.threadId);
  if (!s) return;
  const event = { method, params };
  if (method !== 'thread/realtime/sdp') log('←', method, JSON.stringify(params).slice(0, 160));
  s.backlog.push(event); if (s.backlog.length > 500) s.backlog.shift();
  for (const res of s.sinks) res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (method === 'thread/realtime/closed') { for (const res of s.sinks) res.end(); setTimeout(() => sessions.delete(s.id), 60_000); }
});

async function createSession(body) {
  await codex.ready;
  const session = body?.session ?? {}, transport = body?.transport ?? {};
  if (transport.type !== 'webrtc' || typeof transport.sdp !== 'string') throw Object.assign(new Error('transport.sdp (webrtc) required'), { status: 400 });
  const instructions = String(session.instructions ?? '');
  const requested = session.audio?.output?.voice; const voice = V3_VOICES.has(requested) ? requested : 'cove';
  const thread = await codex.request('thread/start', { ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: instructions, cwd: process.cwd() });
  const threadId = thread.thread.id;
  const initialItems = [{ role: 'developer', text: instructions }];
  for (const item of Array.isArray(session.input) ? session.input : []) if (item && typeof item.text === 'string' && ['user', 'assistant', 'developer'].includes(item.role)) initialItems.push({ role: item.role, text: item.text });
  const record = { id: null, threadId, sinks: new Set(), backlog: [] };
  const started = new Promise((resolve, reject) => {
    const off = codex.on((method, params) => {
      if (params.threadId !== threadId) return;
      if (method === 'thread/realtime/started') record.id = params.realtimeSessionId ?? threadId;
      if (method === 'thread/realtime/sdp') { off(); resolve(params.sdp); }
      if (method === 'thread/realtime/error') { off(); reject(Object.assign(new Error(params.message), { status: 502 })); }
    });
    setTimeout(() => { off(); reject(Object.assign(new Error('timed out waiting for SDP answer'), { status: 504 })); }, 20_000);
  });
  sessions.set(threadId, record); // keyed by threadId until the session id is known
  try {
    await codex.request('thread/realtime/start', { threadId, transport: { type: 'webrtc', sdp: transport.sdp }, outputModality: 'audio', version: 'v3', voice, initialItems, model: session.model ?? MODEL });
    const answer = await started;
    const id = record.id ?? threadId; record.id = id; sessions.delete(threadId); sessions.set(id, record);
    log(`session ${id} started (thread ${threadId}, voice ${voice}, model ${session.model ?? MODEL})`);
    return { session: { id, model: session.model ?? MODEL, voice, provider: 'codex-subscription' }, transport: { type: 'webrtc', sdp: answer } };
  } catch (e) { sessions.delete(threadId); codex.request('thread/realtime/stop', { threadId }).catch(() => {}); throw e; }
}

// ---------- Responses API through the subscription ----------
// The Codex backend requires streaming and omits `output` from `response.completed`, so the bridge assembles a
// non-streaming Responses-shaped result from `response.output_item.done` events for the browser's APIClient.
const CODEX_RESPONSES = 'https://chatgpt.com/backend-api/codex/responses';
const decodeAccountId = token => { try { const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); return c['https://api.openai.com/auth']?.chatgpt_account_id ?? null; } catch { return null; } };
async function subscriptionAuth(refresh = false) {
  await codex.ready;
  const status = await codex.request('getAuthStatus', { includeToken: true, refreshToken: refresh });
  if (status.authMethod !== 'chatgpt' || !status.authToken) throw Object.assign(new Error('codex is not logged in with ChatGPT (run `codex login`)'), { status: 503 });
  return { token: status.authToken, accountId: decodeAccountId(status.authToken) };
}
async function proxyResponses(body, attempt = 0) {
  const { token, accountId } = await subscriptionAuth(attempt > 0);
  const { max_tool_calls: _a, max_output_tokens: _b, ...rest } = body ?? {}; // unsupported by the Codex backend
  const upstream = await fetch(CODEX_RESPONSES, { method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${token}`, ...(accountId ? { 'chatgpt-account-id': accountId } : {}), 'Content-Type': 'application/json', 'User-Agent': 'codex_cli_rs/0.149.0 (mural-bridge)' },
    body: JSON.stringify({ ...rest, stream: true }) });
  if (upstream.status === 401 && attempt === 0) { await upstream.body?.cancel(); return proxyResponses(body, 1); }
  if (!upstream.ok) { const detail = await upstream.text(); throw Object.assign(new Error(`codex backend ${upstream.status}: ${detail.slice(0, 300)}`), { status: upstream.status }); }
  const output = []; let completed = null, failed = null, buffer = '';
  const handle = line => {
    if (!line.startsWith('data: ')) return; const data = line.slice(6).trim(); if (!data || data === '[DONE]') return;
    let e; try { e = JSON.parse(data); } catch { return; }
    if (e.type === 'response.output_item.done' && e.item) output.push(e.item);
    else if (e.type === 'response.completed') completed = e.response;
    else if (e.type === 'response.failed' || e.type === 'response.incomplete' || e.type === 'error') failed = e;
  };
  for await (const chunk of upstream.body) { buffer += Buffer.from(chunk).toString(); let i; while ((i = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } }
  if (buffer) handle(buffer);
  if (failed && !completed) throw Object.assign(new Error(`response ${failed.type}: ${JSON.stringify(failed.response?.error ?? failed.error ?? failed).slice(0, 300)}`), { status: 502 });
  const usage = completed?.usage ?? {};
  return { id: completed?.id ?? null, object: 'response', status: completed ? 'completed' : 'incomplete', model: completed?.model ?? rest.model, output,
    usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 }, provider: 'codex-subscription' };
}

// ---------- http ----------
const json = (res, status, body, origin) => { res.writeHead(status, { 'Content-Type': 'application/json', ...cors(origin) }); res.end(JSON.stringify(body)); };
const cors = origin => ALLOWED_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' } : {};
const readBody = req => new Promise((resolve, reject) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) reject(new Error('too large')); }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } }); });

createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(origin)); return res.end(); }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(res, 403, { error: 'origin not allowed' }, origin);
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') { await codex.ready; return json(res, 200, { ok: true, model: MODEL, sessions: sessions.size }, origin); }
    if (req.method === 'POST' && url.pathname === '/codex/live/sessions') return json(res, 200, await createSession(await readBody(req)), origin);
    if (req.method === 'POST' && url.pathname === '/codex/responses') { const body = await readBody(req); const t0 = Date.now(); const r = await proxyResponses(body); log(`responses ${body.model} → ${r.status}, ${r.output.length} items, ${r.usage.total_tokens} tokens, ${Date.now() - t0}ms`); return json(res, 200, r, origin); }
    const m = url.pathname.match(/^\/codex\/live\/sessions\/([^/]+)\/(events|stop|append)$/);
    if (m) {
      const s = sessions.get(decodeURIComponent(m[1])); if (!s) return json(res, 404, { error: 'unknown session' }, origin);
      if (m[2] === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors(origin) });
        for (const e of s.backlog) res.write(`data: ${JSON.stringify(e)}\n\n`);
        s.sinks.add(res); req.on('close', () => s.sinks.delete(res)); return;
      }
      if (m[2] === 'stop' && req.method === 'POST') { await codex.request('thread/realtime/stop', { threadId: s.threadId }).catch(() => {}); return json(res, 200, { ok: true }, origin); }
      if (m[2] === 'append' && req.method === 'POST') {
        const body = await readBody(req);
        const r = await codex.request('thread/realtime/appendText', { threadId: s.threadId, text: String(body.text ?? '').slice(0, 4000), role: body.role ?? 'developer' });
        return json(res, 200, { ok: true, result: r }, origin);
      }
    }
    json(res, 404, { error: 'not found' }, origin);
  } catch (e) { log('error', e.message); json(res, e.status ?? 500, { error: e.message }, origin); }
}).listen(PORT, HOST, () => log(`mural voice bridge on http://${HOST}:${PORT} → ${MODEL} via codex subscription`));
