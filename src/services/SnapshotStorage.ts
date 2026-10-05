// services/SnapshotStorage.ts
// 스냅샷 보관함 IndexedDB 저장소
//
// - snapshot_meta: 목록 화면용 가벼운 메타데이터
// - snapshot_data: 스냅샷 본문 (번역 결과·설정·용어집)
// - source_files : 원본 파일. 내용 해시를 키로 한 벌만 저장하고 여러 스냅샷이 함께 참조한다
//
// 원본 파일 정리는 참조 카운터를 들고 다니지 않고, 메타 전체를 훑어 아무도 참조하지 않는 원본을 지운다.
// 카운터는 저장·삭제 경로마다 증감을 맞춰야 해서 한 곳만 빠져도 어긋나지만,
// 메타 훑기는 매번 실제 참조로 다시 계산하므로 어긋날 상태가 없다. 메타는 작아서 훑는 비용이 낮다.
//
// DB 이름을 기존 'BTG_Database'와 다르게 둔 이유: 같은 출처(localhost:3000)에서 포크 버전이
// 'BTG_Database'를 v4로 올려 두면, 낮은 버전으로 여는 쪽은 VersionError로 열리지 않는다.

import type {
  ProjectSnapshot,
  SnapshotMeta,
  SnapshotType,
  SourcePayload,
  StoredSourceFile,
} from '../types/snapshot';
import { getSourceRecordKey } from '../utils/sourceHashUtils';

const DB_NAME = 'BTG_SnapshotDB';
const DB_VERSION = 1;
const META_STORE = 'snapshot_meta';
const DATA_STORE = 'snapshot_data';
const SOURCE_STORE = 'source_files';

const AUTO_LIMIT_KEY = 'btg_auto_snapshot_limit';
export const DEFAULT_AUTO_SNAPSHOT_LIMIT = 5;

interface StoredSnapshotData {
  id: string;
  snapshot: ProjectSnapshot;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 트랜잭션이 중단되었습니다.'));
  });
  // 중간 요청이 실패해 먼저 throw하면 이 promise를 await하지 못하므로 처리되지 않은 거부로 남지 않게 한다
  done.catch(() => undefined);
  return done;
}

function generateSnapshotId(): string {
  return `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 내용 없이 참조만 넘긴 원본이 저장소에 없을 때 (그사이 정리되었을 때) 던진다.
 * 호출자는 원본 내용을 담아 다시 저장하면 된다.
 */
export class SourceMissingError extends Error {
  constructor(public readonly fileHash: string) {
    super(`원본 파일이 저장소에 없습니다: ${fileHash}`);
    this.name = 'SourceMissingError';
  }
}

export interface SaveSnapshotOptions {
  /** 지정하면 같은 id의 스냅샷을 덮어쓴다 (자동 스냅샷 세션 갱신) */
  id?: string;
  type: SnapshotType;
  label?: string;
}

export interface LoadedSnapshot {
  meta: SnapshotMeta;
  snapshot: ProjectSnapshot;
  sources: Map<string, StoredSourceFile>;
}

export class SnapshotStorage {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static getIndexedDB(): IDBFactory | undefined {
    if (typeof indexedDB !== 'undefined') return indexedDB;
    return undefined;
  }

  static isAvailable(): boolean {
    return Boolean(this.getIndexedDB());
  }

  private static openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    const idb = this.getIndexedDB();
    if (!idb) {
      return Promise.reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SOURCE_STORE)) db.createObjectStore(SOURCE_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        // 다른 탭이 DB를 올리려 하면 연결을 닫아 막지 않는다
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });
    return this.dbPromise;
  }

  /** 테스트에서 DB를 비운 뒤 연결을 다시 열 때 사용 */
  static async resetConnectionForTests(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise.catch(() => null);
      db?.close();
    }
    this.dbPromise = null;
  }

  static getAutoSnapshotLimit(): number {
    try {
      const parsed = parseInt(localStorage.getItem(AUTO_LIMIT_KEY) || '', 10);
      if (Number.isFinite(parsed) && parsed >= 1) return parsed;
    } catch {
      // 저장소 접근이 막힌 환경에서는 기본값을 쓴다
    }
    return DEFAULT_AUTO_SNAPSHOT_LIMIT;
  }

  static setAutoSnapshotLimit(limit: number): void {
    try {
      localStorage.setItem(AUTO_LIMIT_KEY, String(Math.max(1, Math.floor(limit))));
    } catch {
      // 무시: 다음 실행에 기본값을 쓴다
    }
  }

  /**
   * 스냅샷을 저장한다. 원본 파일·본문·메타를 한 트랜잭션에 쓰므로
   * 메타가 있는데 원본이 없는 상태는 생기지 않는다.
   */
  static async saveSnapshot(
    snapshot: ProjectSnapshot,
    sources: SourcePayload[],
    options: SaveSnapshotOptions
  ): Promise<SnapshotMeta> {
    const db = await this.openDB();
    const tx = db.transaction([META_STORE, DATA_STORE, SOURCE_STORE], 'readwrite');
    const done = transactionDone(tx);
    const metaStore = tx.objectStore(META_STORE);
    const dataStore = tx.objectStore(DATA_STORE);
    const sourceStore = tx.objectStore(SOURCE_STORE);
    const now = new Date().toISOString();

    for (const source of sources) {
      const key = getSourceRecordKey(source.ref.fileHash);
      const existing = await requestToPromise(sourceStore.get(key));
      if (!existing && source.content === undefined && source.data === undefined) {
        tx.abort();
        throw new SourceMissingError(source.ref.fileHash);
      }
      if (!existing) {
        const record: StoredSourceFile = {
          id: key,
          hash: source.ref.fileHash,
          kind: source.ref.kind,
          content: source.content,
          data: source.data,
          size: source.ref.size,
          savedAt: now,
        };
        sourceStore.put(record);
      }
    }

    const id = options.id ?? generateSnapshotId();
    const previous = options.id
      ? ((await requestToPromise(metaStore.get(id))) as SnapshotMeta | undefined)
      : undefined;

    const meta = buildMeta(snapshot, sources, {
      id,
      type: options.type,
      label: options.label ?? previous?.label,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      updateCount: (previous?.updateCount ?? 0) + 1,
    });

    const data: StoredSnapshotData = { id, snapshot };
    dataStore.put(data);
    metaStore.put(meta);

    await done;
    return meta;
  }

  /**
   * 같은 프로젝트의 자동 스냅샷이 한도를 넘으면 오래된 것부터 지우고, 남은 원본을 정리한다.
   * @returns 지운 스냅샷 수
   */
  static async pruneAutoSnapshots(projectId: string, keepId: string, limit = this.getAutoSnapshotLimit()): Promise<number> {
    const metas = await this.listSnapshots();
    const autos = metas
      .filter((m) => m.type === 'auto' && m.projectId === projectId && m.id !== keepId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // keepId 자신이 한 자리를 차지한다
    const toDelete = autos.slice(Math.max(0, limit - 1)).map((m) => m.id);
    if (toDelete.length > 0) {
      await this.deleteSnapshots(toDelete);
    }
    return toDelete.length;
  }

  /**
   * 최신 수정 순으로 메타데이터만 돌려준다
   */
  static async listSnapshots(): Promise<SnapshotMeta[]> {
    const db = await this.openDB();
    const tx = db.transaction(META_STORE, 'readonly');
    const metas = (await requestToPromise(tx.objectStore(META_STORE).getAll())) as SnapshotMeta[];
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  static async loadSnapshot(id: string): Promise<LoadedSnapshot | null> {
    const db = await this.openDB();
    const tx = db.transaction([META_STORE, DATA_STORE, SOURCE_STORE], 'readonly');
    const meta = (await requestToPromise(tx.objectStore(META_STORE).get(id))) as SnapshotMeta | undefined;
    const data = (await requestToPromise(tx.objectStore(DATA_STORE).get(id))) as StoredSnapshotData | undefined;
    if (!meta || !data) return null;

    const sources = new Map<string, StoredSourceFile>();
    const sourceStore = tx.objectStore(SOURCE_STORE);
    for (const ref of data.snapshot.source_files) {
      const record = (await requestToPromise(sourceStore.get(getSourceRecordKey(ref.fileHash)))) as
        | StoredSourceFile
        | undefined;
      if (record) sources.set(ref.fileHash, record);
    }
    return { meta, snapshot: data.snapshot, sources };
  }

  /**
   * 스냅샷을 지우고, 더 이상 참조되지 않는 원본을 같은 트랜잭션에서 정리한다
   */
  static async deleteSnapshots(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.openDB();
    const tx = db.transaction([META_STORE, DATA_STORE, SOURCE_STORE], 'readwrite');
    const done = transactionDone(tx);
    const metaStore = tx.objectStore(META_STORE);
    const dataStore = tx.objectStore(DATA_STORE);
    for (const id of ids) {
      metaStore.delete(id);
      dataStore.delete(id);
    }
    await this.collectUnreferencedSources(tx);
    await done;
  }

  /**
   * 어떤 스냅샷도 참조하지 않는 원본 파일을 지운다 (앱 시작 시 한 번)
   * @returns 지운 원본 수
   */
  static async collectGarbage(): Promise<number> {
    const db = await this.openDB();
    const tx = db.transaction([META_STORE, SOURCE_STORE], 'readwrite');
    const done = transactionDone(tx);
    const removed = await this.collectUnreferencedSources(tx);
    await done;
    return removed;
  }

  private static async collectUnreferencedSources(tx: IDBTransaction): Promise<number> {
    const metas = (await requestToPromise(tx.objectStore(META_STORE).getAll())) as SnapshotMeta[];
    const referenced = new Set<string>();
    metas.forEach((m) => m.sourceHashes.forEach((h) => referenced.add(getSourceRecordKey(h))));

    const sourceStore = tx.objectStore(SOURCE_STORE);
    const keys = (await requestToPromise(sourceStore.getAllKeys())) as string[];
    let removed = 0;
    for (const key of keys) {
      if (!referenced.has(key)) {
        sourceStore.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

function buildMeta(
  snapshot: ProjectSnapshot,
  sources: SourcePayload[],
  base: Pick<SnapshotMeta, 'id' | 'type' | 'label' | 'createdAt' | 'updatedAt' | 'updateCount'>
): SnapshotMeta {
  const chunks = Object.values(snapshot.translated_chunks);
  const translatedChars = chunks.reduce((sum, c) => sum + (c.translated_text?.length ?? 0), 0);
  const totalChars = snapshot.source_files.reduce((sum, s) => sum + (s.kind === 'text' ? s.size : 0), 0);
  const sourceBytes = sources.reduce((sum, s) => sum + (s.data?.byteLength ?? (s.content?.length ?? 0) * 2), 0);
  const project = snapshot.project;

  return {
    ...base,
    projectId: project.projectId,
    projectTitle: project.title,
    projectAuthor: project.author,
    episodeRange: project.episodeRange,
    fileName: snapshot.source_files[0]?.name ?? '',
    mode: snapshot.mode,
    translationMode: snapshot.translation_mode,
    totalChunks: snapshot.progress.total_chunks,
    successfulChunks: snapshot.progress.successful_chunks,
    failedChunks: snapshot.progress.failed_chunks,
    totalChars,
    approxBytes: translatedChars * 2 + sourceBytes,
    hasCover: Boolean(project.modifiedCoverImage || project.originalCoverImage),
    modelName: snapshot.config.modelName,
    sourceHashes: snapshot.source_files.map((s) => s.fileHash),
  };
}
