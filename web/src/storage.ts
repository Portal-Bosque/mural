// Port of App/Storage.swift (LearningStore) on IndexedDB. Like SwiftData in the iOS app, it keeps one JSON document, "mural-v1".
import { Archive, type SessionRecord, type Preferences, newArchive, correctFragment, sessionPassages, MAXIMUM_ENCODED_BYTES, ArchiveError } from './core/models';
import { LearningEngine, type LearnerState } from './core/engine';
import { LanguageRegistry, type LanguageModule } from './core/languages';

const DB = 'mural', STORE = 'documents';
export const ADULT_KEY = 'mural-v1', KIDS_KEY = 'mural-kids-v1';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class LearningStore {
  archive: Archive;
  error?: string;
  onSessionInvalidation?: (id: string) => void;
  onChange?: () => void;
  private writing: Promise<void> = Promise.resolve();
  private constructor(private db: IDBDatabase | null, archive: Archive, private key: string) { this.archive = archive; }

  static async open(key: string = ADULT_KEY): Promise<LearningStore> {
    let db: IDBDatabase | null = null, archive = newArchive(), error: string | undefined;
    try {
      db = await openDB();
      const payload = await idb<string | undefined>(db, 'readonly', s => s.get(key));
      if (payload) archive = Archive.decode(payload);
    } catch (e: any) { error = `Mural couldn’t open its saved learning data (${e?.message ?? e}). Starting fresh; nothing will be overwritten until you save.`; }
    for (const s of archive.sessions) if (s.endedAt === undefined) { s.endedAt = Date.now(); s.endReason = 'App closed before finalization'; }
    const store = new LearningStore(error ? null : db, archive, key);
    store.error = error;
    if (!error) store.persist();
    return store;
  }
  static inMemory(): LearningStore { return new LearningStore(null, newArchive(), ADULT_KEY); }

  get preferences(): Preferences { return this.archive.preferences; }
  get language(): LanguageModule { return LanguageRegistry.module(this.preferences.learningLanguageID) ?? LanguageRegistry.all[0]; }
  get sessions(): SessionRecord[] { return [...this.archive.sessions].sort((a, b) => b.startedAt - a.startedAt); }
  get learningSessions(): SessionRecord[] { return this.sessions.filter(s => s.languageID === this.language.id); }
  get learner(): LearnerState { return LearningEngine.project(this.archive.sessions, this.language.id, this.preferences.hiddenWords); }
  session(id: string) { return this.archive.sessions.find(s => s.id === id); }

  selectLanguage(id: string) { if (!LanguageRegistry.module(id)) return; this.archive.preferences.learningLanguageID = id; this.persist(); }
  updatePreferences(change: (p: Preferences) => void) { change(this.archive.preferences); this.persist(); }
  save(session: SessionRecord) {
    const i = this.archive.sessions.findIndex(s => s.id === session.id);
    if (i >= 0) this.archive.sessions[i] = session; else this.archive.sessions.push(session);
    this.persist();
  }
  deleteSession(id: string) { this.onSessionInvalidation?.(id); this.archive.sessions = this.archive.sessions.filter(s => s.id !== id); this.persist(); }
  hideWord(id: string) { this.archive.preferences.hiddenWords.push(id); this.persist(); }
  correctPassage(sessionID: string, passageID: string, text: string) {
    const session = this.session(sessionID);
    const passage = session && sessionPassages(session).find(p => p.id === passageID && p.speaker === 'user');
    if (!session || !passage) return;
    passage.fragments.forEach((f, offset) => correctFragment(session, f.id, offset === 0 ? text.slice(0, 10_000) : ''));
    this.onSessionInvalidation?.(sessionID);
    this.persist();
  }
  deleteAll() {
    this.archive.sessions.forEach(s => this.onSessionInvalidation?.(s.id));
    this.archive.sessions = []; this.archive.preferences.hiddenWords = []; this.persist();
  }
  exportData(): string { return Archive.encode(this.archive); }
  async importFile(file: File) {
    if (file.size > MAXIMUM_ENCODED_BYTES) throw new ArchiveError('tooLarge');
    const imported = Archive.decode(await file.text());
    this.archive = Archive.merging(this.archive, imported);
    this.persist();
  }
  private persist() {
    this.onChange?.();
    if (!this.db) return;
    let payload: string;
    try { payload = Archive.encode(this.archive); } catch { this.error = 'Mural couldn’t save your progress. Please export a backup and try again.'; return; }
    this.writing = this.writing.then(() => idb(this.db!, 'readwrite', s => s.put(payload, this.key))).then(() => { this.error = undefined; },
      () => { this.error = 'Mural couldn’t save your progress. Please export a backup and try again.'; this.onChange?.(); });
  }
  flush() { return this.writing; }
}
