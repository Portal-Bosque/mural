// Port of App/LiveTransport.swift on the browser's native WebRTC stack.
import type { APIClient } from './api';
import type { VoiceSettings } from './voice';

export type ConnectionState = 'idle' | 'connecting' | 'active' | 'closing' | 'ended' | 'failed';
export type LiveEvent = Record<string, any> & { type: string };

export class TransportError extends Error {
  constructor(public kind: 'microphone' | 'connection' | 'timeout' | 'insecure' | 'bridge') {
    super({
      microphone: 'Allow microphone access for this site to start a conversation.',
      connection: 'The voice connection couldn’t be established. Check your connection and try again.',
      timeout: 'The voice connection took too long. Please try again.',
      insecure: 'The microphone needs a secure page (https or localhost).',
      bridge: 'The Codex voice bridge didn’t answer. Start it with `npm run bridge` in web/ and check the URL in Settings.',
    }[kind]); this.name = 'TransportError';
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class LiveTransport {
  onEvent?: (event: LiveEvent) => void;
  onLevels?: (input: number, output: number) => void;
  onFailure?: (message: string) => void;
  onStep?: (step: string) => void;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private stream?: MediaStream;
  private localTrack?: MediaStreamTrack;
  private meter?: number;
  private attempt = 0;
  private closing = false;
  private lastInput = 0; private lastOutput = 0;
  started = false;
  isMuted = false;
  readonly audio: HTMLAudioElement;
  private sideband?: EventSource;
  private bridge?: { url: string; id: string };
  private sessionStart = 0;

  constructor(audio?: HTMLAudioElement) {
    this.audio = audio ?? new Audio();
    this.audio.autoplay = true;
  }

  async connect(api: APIClient, instructions: string, history: unknown[], voice: VoiceSettings = { provider: 'api', bridgeURL: '', model: '' }): Promise<void> {
    this.disconnect();
    this.closing = false;
    const token = ++this.attempt;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new TransportError('insecure');
    let stream: MediaStream;
    this.onStep?.('Asking for microphone permission');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (e: any) {
      const err = new TransportError('microphone');
      err.message += ` (${e?.name ?? 'error'}${e?.message ? ': ' + e.message : ''})`;
      throw err;
    }
    this.onStep?.('Microphone ready');
    if (token !== this.attempt) { stream.getTracks().forEach(t => t.stop()); throw new DOMException('cancelled', 'AbortError'); }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    this.localTrack = track; this.isMuted = false;

    const peer = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    this.peer = peer;
    peer.addTrack(track, stream);
    peer.ontrack = ({ streams, track: remote }) => {
      this.audio.srcObject = streams[0] ?? new MediaStream([remote]);
      this.audio.play().catch(() => {});
    };
    peer.oniceconnectionstatechange = () => {
      if (peer !== this.peer || this.closing) return;
      if (peer.iceConnectionState === 'failed') this.onFailure?.('The network connection was lost. Tap to start a new conversation.');
    };
    const channel = peer.createDataChannel('oai-events', { ordered: true });
    this.channel = channel;
    channel.onmessage = ({ data }) => {
      if (channel !== this.channel) return;
      let json: LiveEvent;
      try { json = JSON.parse(data); } catch { return; }
      if (json.type === 'session.started') this.started = true;
      // Through the bridge, transcripts arrive on the sideband; the data channel is logged and only non-transcript events pass.
      if (this.bridge) { this.onStep?.(`data channel: ${json.type}`); if (String(json.type).includes('transcript')) return; }
      this.onEvent?.(json);
    };
    channel.onclose = () => {
      if (channel !== this.channel || this.closing) return;
      this.onFailure?.('The voice connection ended unexpectedly. Your conversation has been saved.');
    };

    let candidates = 0;
    peer.onicecandidate = ({ candidate }) => { if (candidate) candidates++; };
    const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await peer.setLocalDescription(offer);
    this.onStep?.('Gathering network candidates');
    // OpenAI answers with its own candidates; a complete local gather is not required.
    // Chrome can take a long time on hosts with VPN/tunnel interfaces, so settle briefly after the first candidate and move on.
    const started = Date.now(); let firstAt = 0;
    while (peer.iceGatheringState !== 'complete') {
      await sleep(100);
      if (token !== this.attempt) throw new DOMException('cancelled', 'AbortError');
      if (candidates > 0 && !firstAt) firstAt = Date.now();
      if (firstAt && Date.now() - firstAt > 1500) break;
      if (Date.now() - started > 8000) break;
    }
    this.onStep?.(`Candidates: ${candidates} (${peer.iceGatheringState})`);
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new TransportError('connection');
    this.onStep?.('Creating voice session');

    const viaBridge = voice.provider === 'codex';
    const body = {
      session: { model: viaBridge ? voice.model : 'gpt-live-1', instructions, input: history, store: false, delegation: { type: 'client' }, audio: { output: { voice: viaBridge ? 'cove' : 'marin' } } },
      transport: { type: 'webrtc', sdp },
    };
    let result: any;
    if (viaBridge) {
      this.onStep?.(`Creating voice session via bridge (${voice.model})`);
      const response = await fetch(voice.bridgeURL.replace(/\/$/, '') + '/codex/live/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) })
        .catch(() => { throw new TransportError('bridge'); });
      result = await response.json().catch(() => ({}));
      if (!response.ok) { const err = new TransportError('bridge'); err.message += ` (${result?.error ?? response.status})`; throw err; }
    } else result = await api.post('live/sessions', body);
    if (token !== this.attempt) throw new DOMException('cancelled', 'AbortError');
    const answer = result?.transport?.sdp;
    if (typeof answer !== 'string') throw new TransportError('connection');
    if (result.session) this.onEvent?.({ type: 'mural.session.created', session: result.session });
    await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    if (viaBridge) this.openSideband(voice.bridgeURL.replace(/\/$/, ''), String(result.session?.id ?? ''), token);
    this.onStep?.('Session created, waiting for start');

    const readyDeadline = Date.now() + 20_000;
    while (!this.started) {
      await sleep(100);
      if (token !== this.attempt) throw new DOMException('cancelled', 'AbortError');
      if (Date.now() > readyDeadline) throw new TransportError('timeout');
    }
    this.onStep?.('Session started');
    this.startMetering();
  }

  send(event: Record<string, unknown>): boolean {
    if (this.bridge) {
      // The bridge session takes text through the app-server, not through client data-channel events.
      const type = String(event.type ?? '');
      if (type === 'session.close') { fetch(`${this.bridge.url}/codex/live/sessions/${encodeURIComponent(this.bridge.id)}/stop`, { method: 'POST' }).catch(() => {}); return true; }
      if (type.endsWith('.append') && typeof event.content === 'string') {
        const role = type === 'session.commentary.append' ? 'assistant' : 'developer';
        fetch(`${this.bridge.url}/codex/live/sessions/${encodeURIComponent(this.bridge.id)}/append`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: event.content, role }) })
          .then(r => { if (!r.ok) this.onStep?.(`append rejected (${r.status})`); }).catch(() => this.onStep?.('append failed'));
        return true;
      }
      if (type.startsWith('session.input_audio.')) return true; // handled locally by track.enabled
    }
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return false;
    try { channel.send(JSON.stringify(event)); return true; } catch { return false; }
  }
  private openSideband(url: string, id: string, token: number) {
    this.bridge = { url, id }; this.sessionStart = Date.now();
    const es = new EventSource(`${url}/codex/live/sessions/${encodeURIComponent(id)}/events`);
    this.sideband = es;
    es.onmessage = ({ data }) => {
      if (token !== this.attempt) return;
      let msg: { method: string; params: any }; try { msg = JSON.parse(data); } catch { return; }
      const { method, params } = msg; const now = Date.now() - this.sessionStart;
      switch (method) {
        case 'thread/realtime/started': this.started = true; this.onEvent?.({ type: 'session.started', session: { id } }); break;
        case 'thread/realtime/transcript/delta': {
          const type = params.role === 'user' ? 'session.input_transcript.delta' : 'session.output_transcript.delta';
          this.onEvent?.({ type, event_id: crypto.randomUUID(), delta: String(params.delta ?? ''), start_ms: Math.max(0, now - 50), end_ms: now }); break;
        }
        case 'thread/realtime/transcript/done': this.onStep?.(`transcript done (${params.role}): ${String(params.text ?? '').slice(0, 60)}`); break;
        case 'thread/realtime/itemAdded': this.onStep?.(`item: ${JSON.stringify(params.item).slice(0, 120)}`); break;
        case 'thread/realtime/error': this.onFailure?.(`Codex realtime error: ${params.message}`); break;
        case 'thread/realtime/closed': this.onEvent?.({ type: 'session.closed', reason: params.reason ?? 'closed', usage: { seconds: Math.round(now / 1000) } }); break;
      }
    };
    es.onerror = () => { if (token === this.attempt && this.started && !this.closing) this.onStep?.('sideband reconnecting…'); };
  }
  mute(muted: boolean) {
    this.isMuted = muted;
    if (this.localTrack) this.localTrack.enabled = !muted;
    this.send({ type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: crypto.randomUUID() });
  }
  close() {
    this.closing = true;
    if (this.localTrack) this.localTrack.enabled = false;
    this.isMuted = true;
    this.send({ type: 'session.close', event_id: crypto.randomUUID() });
  }
  disconnect() {
    this.attempt++;
    if (this.meter) { clearInterval(this.meter); this.meter = undefined; }
    this.started = false; this.closing = true;
    if (this.localTrack) { this.localTrack.enabled = false; this.localTrack = undefined; }
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined;
    if (this.channel) { this.channel.onmessage = null; this.channel.onclose = null; this.channel.close(); this.channel = undefined; }
    if (this.peer) { this.peer.ontrack = null; this.peer.onicecandidate = null; this.peer.oniceconnectionstatechange = null; this.peer.close(); this.peer = undefined; }
    if (this.sideband) { this.sideband.close(); this.sideband = undefined; }
    if (this.bridge) { const b = this.bridge; this.bridge = undefined; fetch(`${b.url}/codex/live/sessions/${encodeURIComponent(b.id)}/stop`, { method: 'POST' }).catch(() => {}); }
    this.audio.srcObject = null;
    this.lastInput = 0; this.lastOutput = 0; this.onLevels?.(0, 0);
  }
  private startMetering() {
    if (this.meter) clearInterval(this.meter);
    this.meter = window.setInterval(async () => {
      const peer = this.peer;
      if (!peer || !this.started) return;
      let input = 0, output = 0;
      try {
        const report = await peer.getStats();
        report.forEach((stat: any) => {
          const level = typeof stat.audioLevel === 'number' ? stat.audioLevel : 0;
          if (stat.type === 'inbound-rtp' && stat.kind === 'audio') output = Math.max(output, level);
          if (stat.type === 'media-source' && stat.kind === 'audio') input = Math.max(input, level);
        });
      } catch { return; }
      if (!this.started) return;
      this.lastInput = this.lastInput * 0.35 + Math.min(1, input * 4) * 0.65;
      this.lastOutput = this.lastOutput * 0.35 + Math.min(1, output * 4) * 0.65;
      this.onLevels?.(this.isMuted ? 0 : this.lastInput, this.lastOutput);
    }, 100);
  }
}
