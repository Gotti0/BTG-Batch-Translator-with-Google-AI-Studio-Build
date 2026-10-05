// services/LegacyDataMigration.ts
// 이전 버전이 브라우저에 남긴 작업을 스냅샷 보관함으로 한 번 옮긴다.
//
// 이전 버전은 설정('btg-settings')과 용어집('btg-glossary')을 localStorage에,
// 마지막 작업을 IndexedDB 'BTG_Database'의 autosave_store에 저장했다.
// 지금은 설정·용어집을 따로 저장하지 않으므로, 지우기 전에 이 셋을 묶어 수동 스냅샷 하나로 보존한다.

import type { AppConfig } from '../types/config';
import type { SnapshotMeta } from '../types/snapshot';
import { SnapshotStorage } from './SnapshotStorage';
import { SnapshotZipService, type ParsedSnapshotFile } from './SnapshotZipService';
import { createEmptySnapshot, normalizeConfig, normalizeGlossaryEntries } from './snapshotFormat';

const MIGRATION_MARKER_KEY = 'btg_snapshot_migration_v1';
const LEGACY_SETTINGS_KEY = 'btg-settings';
const LEGACY_GLOSSARY_KEY = 'btg-glossary';
const LEGACY_CONFIG_KEY = 'btg_config';
const LEGACY_DB_NAME = 'BTG_Database';
const LEGACY_STORE_NAME = 'autosave_store';
const LEGACY_SNAPSHOT_KEY = 'latest_snapshot';

export const LEGACY_MIGRATION_LABEL = '이전 버전에서 옮긴 작업';

function readJson(key: string): any {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * 이전 버전의 자동 저장 레코드를 읽는다. DB나 저장소가 없으면 null.
 * 버전을 지정하지 않고 열어, 다른 앱이 DB 버전을 올려 두었어도 VersionError 없이 읽는다.
 */
export function readLegacyAutosave(): Promise<any | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    // DB가 없으면 open이 새로 만들려고 하므로 생성을 취소한다
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.close();
        resolve(null);
        return;
      }
      const get = db.transaction(LEGACY_STORE_NAME, 'readonly').objectStore(LEGACY_STORE_NAME).get(LEGACY_SNAPSHOT_KEY);
      get.onsuccess = () => {
        db.close();
        const value = get.result;
        resolve(value && (value.source_text || value.epub_binary) ? value : null);
      };
      get.onerror = () => {
        db.close();
        resolve(null);
      };
    };
  });
}

/**
 * 이전 버전 데이터를 스냅샷 하나로 옮긴다. 이미 옮겼거나 옮길 것이 없으면 null.
 * 저장에 실패하면 원래 데이터를 지우지 않으므로 다음 실행에 다시 시도한다.
 */
export async function migrateLegacyData(): Promise<SnapshotMeta | null> {
  let storage: Storage;
  try {
    storage = localStorage;
    if (storage.getItem(MIGRATION_MARKER_KEY)) return null;
  } catch {
    // localStorage를 쓸 수 없으면 옮겼다는 표시도 남길 수 없어 매번 중복 생성되므로 건너뛴다
    return null;
  }

  const legacySettings = readJson(LEGACY_SETTINGS_KEY)?.state?.config as Partial<AppConfig> | undefined;
  const legacyConfig = readJson(LEGACY_CONFIG_KEY) as Partial<AppConfig> | undefined;
  const legacyGlossary = readJson(LEGACY_GLOSSARY_KEY)?.state?.entries as any[] | undefined;
  const legacyAutosave = await readLegacyAutosave();

  const hasGlossary = Array.isArray(legacyGlossary) && legacyGlossary.length > 0;
  if (!legacySettings && !legacyConfig && !hasGlossary && !legacyAutosave) {
    storage.setItem(MIGRATION_MARKER_KEY, new Date().toISOString());
    return null;
  }

  let parsed: ParsedSnapshotFile;
  if (legacyAutosave) {
    parsed = await SnapshotZipService.fromLegacyJson(legacyAutosave);
  } else {
    parsed = { snapshot: createEmptySnapshot(), sources: [] };
    parsed.snapshot.project = { ...parsed.snapshot.project, title: LEGACY_MIGRATION_LABEL };
  }

  // localStorage의 설정이 자동 저장 레코드보다 최신이고 전체 필드를 갖고 있다
  if (legacySettings || legacyConfig) {
    parsed.snapshot.config = normalizeConfig({ ...(legacyConfig ?? {}), ...(legacySettings ?? {}) });
  }
  if (hasGlossary) {
    parsed.snapshot.glossary_entries = normalizeGlossaryEntries(legacyGlossary);
  }

  const meta = await SnapshotStorage.saveSnapshot(parsed.snapshot, parsed.sources, {
    type: 'manual',
    label: LEGACY_MIGRATION_LABEL,
  });

  storage.removeItem(LEGACY_SETTINGS_KEY);
  storage.removeItem(LEGACY_GLOSSARY_KEY);
  storage.removeItem(LEGACY_CONFIG_KEY);
  storage.setItem(MIGRATION_MARKER_KEY, new Date().toISOString());
  return meta;
}
