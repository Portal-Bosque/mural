// Voice provider selection. 'api' talks to api.openai.com with the user's key; 'codex' goes through the local bridge
// (bridge/server.mjs), which brokers gpt-live-1-codex sessions with the ChatGPT/Codex subscription.
export type VoiceProvider = 'api' | 'codex';
export interface VoiceSettings { provider: VoiceProvider; bridgeURL: string; model: string }
const KEY = 'mural.voice';
// VITE_BRIDGE_URL (build-time) lets a deployment default to a bridge reachable from other devices, e.g. over Tailscale.
export const DEFAULT_BRIDGE: string = (import.meta.env.VITE_BRIDGE_URL as string | undefined) || 'http://localhost:8790';
export function loadVoiceSettings(): VoiceSettings {
  try { return { provider: 'api', bridgeURL: DEFAULT_BRIDGE, model: 'gpt-live-1-codex', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { provider: 'api', bridgeURL: DEFAULT_BRIDGE, model: 'gpt-live-1-codex' }; }
}
export function saveVoiceSettings(s: VoiceSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
