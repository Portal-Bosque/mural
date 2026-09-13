// Mural voice bridge: brokers gpt-live-1-codex realtime sessions through `codex app-server`, so the browser can use the
// ChatGPT/Codex subscription instead of an API key. The browser keeps talking WebRTC directly to OpenAI; only signalling
// and the sideband events pass through here. Node ≥ 22, no dependencies.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? '127.0.0.1';
const MODEL = process.env.MURAL_LIVE_MODEL ?? 'gpt-live-1-codex';
const ALLOWED_ORIGINS = (process.env.MURAL_ORIGINS ?? 'http://localhost:5173,https://mural-web-delta.vercel.app').split(',');
// Optional: serve the built page from the same origin (MURAL_STATIC=/path/to/dist), so page + API sit behind one Cloudflare Access app.
const STATIC_DIR = process.env.MURAL_STATIC ? resolve(process.env.MURAL_STATIC) : null;
// Optional: Cloudflare Access. Requests that arrive through Cloudflare (cf-ray present) must carry a valid Access JWT
// (cookie CF_Authorization or header cf-access-jwt-assertion) issued by CF_ACCESS_TEAM_DOMAIN, optionally for CF_ACCESS_AUD.
const CF_TEAM = process.env.CF_ACCESS_TEAM_DOMAIN ?? null;
const CF_AUD = process.env.CF_ACCESS_AUD ?? null;
// Abuse limits for a public deployment (per client IP and global). Override with MURAL_LIMITS as JSON.
const LIMITS = { sessionsPerHourPerIP: 30, concurrentPerIP: 3, concurrentGlobal: 8, responsesPer10MinPerIP: 240, ...JSON.parse(process.env.MURAL_LIMITS ?? '{}') };
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
  if (method === 'thread/realtime/closed') { s.closed = true; for (const res of s.sinks) res.end(); setTimeout(() => sessions.delete(s.id), 60_000); }
});

async function createSession(body, ip = 'local') {
  await codex.ready;
  if (activeGlobal() >= LIMITS.concurrentGlobal) throw Object.assign(new Error('Mural is busy right now; try again in a few minutes.'), { status: 429 });
  if (activeByIP(ip) >= LIMITS.concurrentPerIP) throw Object.assign(new Error('You already have a conversation running.'), { status: 429 });
  if (!allow(`sess:${ip}`, LIMITS.sessionsPerHourPerIP, 3600_000)) throw Object.assign(new Error('Conversation limit reached for now; try again later.'), { status: 429 });
  const session = body?.session ?? {}, transport = body?.transport ?? {};
  if (transport.type !== 'webrtc' || typeof transport.sdp !== 'string') throw Object.assign(new Error('transport.sdp (webrtc) required'), { status: 400 });
  const instructions = String(session.instructions ?? '');
  const requested = session.audio?.output?.voice; const voice = V3_VOICES.has(requested) ? requested : 'cove';
  const thread = await codex.request('thread/start', { ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: instructions, cwd: process.cwd() });
  const threadId = thread.thread.id;
  const initialItems = [{ role: 'developer', text: instructions }];
  for (const item of Array.isArray(session.input) ? session.input : []) if (item && typeof item.text === 'string' && ['user', 'assistant', 'developer'].includes(item.role)) initialItems.push({ role: item.role, text: item.text });
  const record = { id: null, threadId, sinks: new Set(), backlog: [], ip, closed: false, startedAt: Date.now() };
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
    setTimeout(() => { if (!record.closed) { log(`session ${id} hard cap reached, stopping`); codex.request('thread/realtime/stop', { threadId }).catch(() => {}); } }, 20 * 60_000).unref();
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

// ---------- Cloudflare Access JWT verification (RS256 against the team JWKS) ----------
let jwks = { keys: [], fetchedAt: 0 };
async function accessKeys(force = false) {
  if (!force && jwks.keys.length && Date.now() - jwks.fetchedAt < 6 * 3600_000) return jwks.keys;
  const r = await fetch(`https://${CF_TEAM}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  jwks = { keys: (await r.json()).keys ?? [], fetchedAt: Date.now() }; return jwks.keys;
}
const b64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
async function verifyAccessJWT(token) {
  const parts = token.split('.'); if (parts.length !== 3) return null;
  const header = JSON.parse(b64url(parts[0]).toString()), payload = JSON.parse(b64url(parts[1]).toString());
  if (header.alg !== 'RS256') return null;
  let key = (await accessKeys()).find(k => k.kid === header.kid);
  if (!key) key = (await accessKeys(true)).find(k => k.kid === header.kid);
  if (!key) return null;
  const ok = cryptoVerify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key, format: 'jwk' }), b64url(parts[2]));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now || (typeof payload.nbf === 'number' && payload.nbf > now + 60)) return null;
  if (payload.iss !== `https://${CF_TEAM}`) return null;
  if (CF_AUD && !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(CF_AUD)) return null;
  return payload;
}
async function accessGate(req) {
  if (!CF_TEAM || !req.headers['cf-ray']) return { ok: true, user: null }; // local / non-Cloudflare traffic
  const cookie = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith('CF_Authorization='));
  const token = req.headers['cf-access-jwt-assertion'] ?? (cookie ? cookie.slice('CF_Authorization='.length) : null);
  if (!token) return { ok: false };
  try { const p = await verifyAccessJWT(String(token)); return p ? { ok: true, user: p.email ?? p.sub ?? null } : { ok: false }; } catch { return { ok: false }; }
}

// ---------- static page ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };
async function serveStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(STATIC_DIR, rel === '/' || rel === '' ? 'index.html' : rel);
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end(); }
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { file = join(STATIC_DIR, 'index.html'); }
  try {
    const body = await readFile(file);
    const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.includes('/assets/') || file.includes('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    res.writeHead(200, headers); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}

// ---------- rate limiting ----------
const clientIP = req => String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
const windows = new Map(); // key → timestamps
function allow(key, max, windowMs) {
  const now = Date.now(); const list = (windows.get(key) ?? []).filter(t => now - t < windowMs);
  if (list.length >= max) { windows.set(key, list); return false; }
  list.push(now); windows.set(key, list); return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of windows) if (!v.some(t => now - t < 3600_000)) windows.delete(k); }, 600_000).unref();
const activeByIP = ip => [...sessions.values()].filter(s => s.ip === ip && !s.closed).length;
const activeGlobal = () => [...sessions.values()].filter(s => !s.closed).length;

// ---------- http ----------
const json = (res, status, body, origin) => { res.writeHead(status, { 'Content-Type': 'application/json', ...cors(origin) }); res.end(JSON.stringify(body)); };
const cors = origin => ALLOWED_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' } : {};
const sameOrigin = (req, origin) => { const host = req.headers['x-forwarded-host'] ?? req.headers.host; return !!host && (origin === `https://${host}` || origin === `http://${host}`); };
const readBody = req => new Promise((resolve, reject) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) reject(new Error('too large')); }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } }); });

createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(origin)); return res.end(); }
  if (origin && !ALLOWED_ORIGINS.includes(origin) && !sameOrigin(req, origin)) return json(res, 403, { error: 'origin not allowed' }, origin);
  const gate = await accessGate(req);
  if (!gate.ok) { log('access denied', url.pathname, req.headers['cf-connecting-ip'] ?? ''); return json(res, 401, { error: 'Cloudflare Access authentication required' }, origin); }
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') { await codex.ready; return json(res, 200, { ok: true, model: MODEL, sessions: sessions.size, access: CF_TEAM ? 'enforced' : 'off', user: gate.user }, origin); }
    const ip = clientIP(req);
    if (req.method === 'POST' && url.pathname === '/codex/live/sessions') { const r = await createSession(await readBody(req), ip); log(`session for ${ip}`); return json(res, 200, r, origin); }
    if (req.method === 'POST' && url.pathname === '/codex/responses') {
      if (!allow(`resp:${ip}`, LIMITS.responsesPer10MinPerIP, 600_000)) return json(res, 429, { error: 'Too many requests; slow down a little.' }, origin);
      const body = await readBody(req); const t0 = Date.now(); const r = await proxyResponses(body); log(`responses ${body.model} → ${r.status}, ${r.output.length} items, ${r.usage.total_tokens} tokens, ${Date.now() - t0}ms`); return json(res, 200, r, origin); }
    const m = url.pathname.match(/^\/codex\/live\/sessions\/([^/]+)\/(events|stop|append)$/);
    if (m) {
      const s = sessions.get(decodeURIComponent(m[1])); if (!s) return json(res, 404, { error: 'unknown session' }, origin);
      if (m[2] === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors(origin) });
        for (const e of s.backlog) res.write(`data: ${JSON.stringify(e)}\n\n`);
        s.sinks.add(res);
        const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20_000); // keeps proxies (Cloudflare) from idling the stream out
        req.on('close', () => { clearInterval(beat); s.sinks.delete(res); }); return;
      }
      if (m[2] === 'stop' && req.method === 'POST') { await codex.request('thread/realtime/stop', { threadId: s.threadId }).catch(() => {}); return json(res, 200, { ok: true }, origin); }
      if (m[2] === 'append' && req.method === 'POST') {
        const body = await readBody(req);
        const r = await codex.request('thread/realtime/appendText', { threadId: s.threadId, text: String(body.text ?? '').slice(0, 4000), role: body.role ?? 'developer' });
        return json(res, 200, { ok: true, result: r }, origin);
      }
    }
    if (STATIC_DIR && req.method === 'GET' && !url.pathname.startsWith('/codex/')) return serveStatic(url.pathname, res);
    json(res, 404, { error: 'not found' }, origin);
  } catch (e) { log('error', e.message); json(res, e.status ?? 500, { error: e.message }, origin); }
}).listen(PORT, HOST, () => log(`mural voice bridge on http://${HOST}:${PORT} → ${MODEL} via codex subscription${STATIC_DIR ? `; serving ${STATIC_DIR}` : ''}${CF_TEAM ? `; Cloudflare Access enforced (${CF_TEAM}${CF_AUD ? ', aud ' + CF_AUD.slice(0, 8) + '…' : ''})` : ''}`));
