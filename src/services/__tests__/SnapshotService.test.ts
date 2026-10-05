import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { SnapshotService } from '../SnapshotService';
import { SnapshotStorage } from '../SnapshotStorage';
import { SnapshotZipService } from '../SnapshotZipService';
import { migrateLegacyData, LEGACY_MIGRATION_LABEL } from '../LegacyDataMigration';
import { ChunkService } from '../ChunkService';
import { useTranslationStore } from '../../stores/translationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGlossaryStore } from '../../stores/glossaryStore';
import { useProjectStore } from '../../stores/projectStore';
import { defaultConfig } from '../../types/config';
import { createDefaultProjectMetadata } from '../../types/project';
import type { TranslationResult } from '../../types/dtos';

const SOURCE = Array.from({ length: 30 }, (_, i) => `원문 줄 ${i + 1} 입니다.\n`).join('');

async function resetAll() {
  await SnapshotStorage.resetConnectionForTests();
  (globalThis as any).indexedDB = new IDBFactory();
  localStorage.clear();
  SnapshotService.resetForTests();
  useTranslationStore.getState().reset();
  useSettingsStore.getState().resetConfig();
  useGlossaryStore.getState().clearEntries();
  useProjectStore.getState().setProject(createDefaultProjectMetadata());
}

/** 원문을 청크로 나누고 일부만 번역된 상태를 스토어에 올린다 */
function loadTranslatedWork(chunkSize = 100): TranslationResult[] {
  useSettingsStore.getState().updateConfig({ chunkSize, modelName: 'test-model' });
  useProjectStore.getState().updateProject({ title: '테스트 소설', author: '작가' });
  useGlossaryStore.getState().setEntries([
    { keyword: '원문', translatedKeyword: 'source', targetLanguage: 'en', occurrenceCount: 3 },
  ]);
  const chunks = new ChunkService(chunkSize).splitTextIntoChunks(SOURCE);
  const results: TranslationResult[] = chunks.slice(0, 3).map((text, i) => ({
    chunkIndex: i,
    originalText: text,
    translatedText: `번역${i}`,
    success: i !== 1,
    error: i === 1 ? '실패' : undefined,
  }));
  const store = useTranslationStore.getState();
  store.setInputFiles([{ name: 'novel.txt', content: SOURCE, size: SOURCE.length, lastModified: 1 }]);
  store.setResults(results);
  return results;
}

describe('SnapshotService', () => {
  beforeEach(resetAll);

  it('수동 스냅샷을 저장하고 다른 상태에서 그대로 복원한다', async () => {
    const results = loadTranslatedWork();
    const meta = await SnapshotService.saveManualSnapshot();
    expect(meta.successfulChunks).toBe(2);
    expect(meta.failedChunks).toBe(1);

    // 상태를 전부 비운 뒤 복원
    useTranslationStore.getState().resetWork();
    useSettingsStore.getState().resetConfig();
    useGlossaryStore.getState().clearEntries();
    useProjectStore.getState().setProject(createDefaultProjectMetadata());

    const restored = await SnapshotService.restoreSnapshotById(meta.id);
    expect(restored).toMatchObject({ mode: 'text', restoredChunks: 3, droppedChunks: 0 });

    const state = useTranslationStore.getState();
    expect(state.inputFiles[0].content).toBe(SOURCE);
    expect(state.results.map((r) => r.originalText)).toEqual(results.map((r) => r.originalText));
    expect(state.results[1]).toMatchObject({ success: false, error: '실패' });
    expect(state.translatedText).toBe('번역0번역2');
    expect(useSettingsStore.getState().config).toMatchObject({ chunkSize: 100, modelName: 'test-model' });
    expect(useGlossaryStore.getState().entries).toHaveLength(1);
    expect(useProjectStore.getState().project.title).toBe('테스트 소설');
  });

  it('청크 크기 설정이 바뀌어 있어도 저장된 오프셋으로 원문을 맞춘다', async () => {
    const results = loadTranslatedWork(100);
    const meta = await SnapshotService.saveManualSnapshot();
    const loaded = await SnapshotStorage.loadSnapshot(meta.id);
    loaded!.snapshot.config.chunkSize = 37; // 다른 분할로 저장된 것처럼

    await SnapshotService.applySnapshot(loaded!.snapshot, loaded!.sources);
    expect(useTranslationStore.getState().results.map((r) => r.originalText)).toEqual(results.map((r) => r.originalText));
  });

  it('같은 원문은 여러 스냅샷이 한 벌만 저장하고, 마지막 참조가 지워지면 원본도 정리한다', async () => {
    loadTranslatedWork();
    const first = await SnapshotService.saveManualSnapshot();
    const second = await SnapshotService.saveManualSnapshot();
    expect(first.sourceHashes).toEqual(second.sourceHashes);

    await SnapshotStorage.deleteSnapshots([first.id]);
    expect(await SnapshotStorage.loadSnapshot(second.id)).not.toBeNull();
    expect((await SnapshotStorage.loadSnapshot(second.id))!.sources.size).toBe(1);

    await SnapshotStorage.deleteSnapshots([second.id]);
    expect(await SnapshotStorage.collectGarbage()).toBe(0); // 이미 삭제 트랜잭션에서 정리됨
  });

  it('자동 스냅샷은 세션 안에서 제자리 갱신되고, 새 세션마다 새로 만들며 개수 한도를 지킨다', async () => {
    SnapshotStorage.setAutoSnapshotLimit(2);
    loadTranslatedWork();

    for (let session = 0; session < 3; session++) {
      SnapshotService.requestAutoSave();
      await SnapshotService.flushAutoSnapshot();
      useProjectStore.getState().updateProject({ memo: `세션 ${session}` });
      SnapshotService.requestAutoSave();
      await SnapshotService.flushAutoSnapshot();
      await SnapshotService.beginNewAutoSession();
    }

    const autos = (await SnapshotStorage.listSnapshots()).filter((m) => m.type === 'auto');
    expect(autos).toHaveLength(2);
    expect(autos.every((m) => m.updateCount === 2)).toBe(true);
  });

  it('빈 새 프로젝트는 자동 저장하지 않는다', async () => {
    SnapshotService.requestAutoSave();
    await SnapshotService.flushAutoSnapshot();
    expect(await SnapshotStorage.listSnapshots()).toHaveLength(0);
  });

  it('원본이 정리된 뒤에도 원본 내용을 다시 담아 저장한다', async () => {
    loadTranslatedWork();
    const first = await SnapshotService.saveManualSnapshot();
    await SnapshotStorage.deleteSnapshots([first.id]); // 원본까지 정리됨
    const second = await SnapshotService.saveManualSnapshot();
    expect((await SnapshotStorage.loadSnapshot(second.id))!.sources.size).toBe(1);
  });
});

describe('SnapshotZipService', () => {
  beforeEach(resetAll);

  it('ZIP으로 내보낸 스냅샷을 다시 읽으면 원문·번역·설정·용어집·표지가 같다', async () => {
    loadTranslatedWork();
    useProjectStore.getState().updateProject({ modifiedCoverImage: 'data:image/png;base64,iVBORw0KGgo=' });
    const { snapshot, sources } = await SnapshotService.buildCurrentSnapshot(true);
    const blob = await SnapshotZipService.exportToZip(
      snapshot,
      new Map(sources.map((s) => [s.ref.fileHash, { content: s.content }]))
    );

    const parsed = await SnapshotZipService.parseSnapshotFile(new File([blob], 'work.zip'));
    expect(parsed.sources[0].content).toBe(SOURCE);
    expect(parsed.snapshot.translated_chunks).toEqual(snapshot.translated_chunks);
    expect(parsed.snapshot.config).toEqual(snapshot.config);
    expect(parsed.snapshot.glossary_entries[0]).toMatchObject({ keyword: '원문', translatedKeyword: 'source' });
    expect(parsed.snapshot.project.modifiedCoverImage).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('포크 앱이 만든 ZIP(스네이크 케이스 설정, term/translated 용어집, 미번역 청크 포함)을 읽는다', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ format: 'btg-snapshot-zip', mode: 'text', project: { title: '포크 작품', author: 'A' } }));
    zip.file('config.json', JSON.stringify({ chunk_size: 100, model_name: 'fork-model', enable_system_instruction: true, system_instruction: '지침' }));
    zip.file('source/input_files.json', JSON.stringify([{ index: 0, name: 'n.txt', path: 'source/files/00_n.txt' }]));
    zip.file('source/files/00_n.txt', SOURCE);
    zip.file('chunks/0.json', JSON.stringify({ chunk_index: 0, translated_text: '첫 청크', status: 'completed', char_range: [0, 100] }));
    zip.file('chunks/1.json', JSON.stringify({ chunk_index: 1, translated_text: '', status: 'estimated' }));
    zip.file('glossaries/index.json', JSON.stringify({ project_glossaries: [{ file: 'glossaries/00_g.json' }] }));
    zip.file('glossaries/00_g.json', JSON.stringify({ enabled: true, entries: [{ term: '王', translated: '왕', occurrence_count: 2 }] }));
    const blob = await zip.generateAsync({ type: 'blob' });

    const parsed = await SnapshotZipService.parseSnapshotFile(new File([blob], 'fork.zip'));
    expect(parsed.snapshot.config).toMatchObject({
      chunkSize: 100,
      modelName: 'fork-model',
      enablePrefillTranslation: true,
      prefillSystemInstruction: '지침',
    });
    expect(Object.keys(parsed.snapshot.translated_chunks)).toEqual(['0']);
    expect(parsed.snapshot.glossary_entries[0]).toMatchObject({ keyword: '王', translatedKeyword: '왕', occurrenceCount: 2 });
  });

  it('이전 버전 JSON 스냅샷을 변환한다', async () => {
    const chunks = new ChunkService(100).splitTextIntoChunks(SOURCE);
    const legacy = {
      meta: { version: '1.1', created_at: '2026-01-01T00:00:00Z', app_version: '0.0.3' },
      source_info: { file_name: 'old.txt', file_size: SOURCE.length },
      config: { chunk_size: 100, model_name: 'old-model' },
      source_text: SOURCE,
      progress: { total_chunks: chunks.length, processed_chunks: 1 },
      translated_chunks: { '2': { original_text: chunks[2], translated_text: '셋째', status: 'success' } },
    };
    const parsed = await SnapshotZipService.parseSnapshotFile(new File([JSON.stringify(legacy)], 'old.json'));
    expect(parsed.snapshot.config.modelName).toBe('old-model');
    expect(parsed.snapshot.translated_chunks['2']).toMatchObject({ status: 'completed', translated_text: '셋째' });
    expect(parsed.snapshot.translated_chunks['2'].char_range).toBeDefined();
  });
});

describe('LegacyDataMigration', () => {
  beforeEach(resetAll);

  it('localStorage 설정·용어집을 스냅샷 하나로 옮긴 뒤 지우고, 두 번째 실행에서는 아무것도 하지 않는다', async () => {
    localStorage.setItem('btg-settings', JSON.stringify({ state: { config: { ...defaultConfig, modelName: 'legacy-model' } }, version: 0 }));
    localStorage.setItem('btg-glossary', JSON.stringify({ state: { entries: [{ keyword: 'k', translatedKeyword: '케이', targetLanguage: 'ko', occurrenceCount: 1 }] } }));

    const meta = await migrateLegacyData();
    expect(meta?.label).toBe(LEGACY_MIGRATION_LABEL);
    expect(localStorage.getItem('btg-settings')).toBeNull();
    expect(localStorage.getItem('btg-glossary')).toBeNull();

    const loaded = await SnapshotStorage.loadSnapshot(meta!.id);
    expect(loaded!.snapshot.config.modelName).toBe('legacy-model');
    expect(loaded!.snapshot.glossary_entries).toHaveLength(1);

    expect(await migrateLegacyData()).toBeNull();
  });
});
