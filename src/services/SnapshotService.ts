// services/SnapshotService.ts
// 현재 작업 상태(설정·프로젝트·용어집·원문·번역 결과)를 스냅샷으로 만들고, 저장·자동 저장·복원한다.
//
// 설정과 용어집은 브라우저 저장소에 따로 남기지 않는다. 새로고침하면 기본값으로 시작하고,
// 작업 상태는 스냅샷 보관함에서 복원한다.

import { useTranslationStore } from '../stores/translationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGlossaryStore } from '../stores/glossaryStore';
import { useProjectStore } from '../stores/projectStore';
import type { FileContent, TranslationJobProgress, TranslationResult } from '../types/dtos';
import type {
  ProjectSnapshot,
  SnapshotMeta,
  SnapshotSourceRef,
  SourcePayload,
  StoredSourceFile,
} from '../types/snapshot';
import { createDefaultProjectMetadata, DEFAULT_PROJECT_METADATA, resolveOutputFileName } from '../types/project';
import { calculateBinaryHash, calculateContentHash } from '../utils/sourceHashUtils';
import { triggerDownload } from '../utils/downloadUtils';
import { SnapshotStorage, SourceMissingError } from './SnapshotStorage';
import { SnapshotZipService } from './SnapshotZipService';
import {
  buildTranslatedChunks,
  computeTextChunkRanges,
  createEmptySnapshot,
  normalizeConfig,
  restoreTextResults,
} from './snapshotFormat';
import { EpubService } from './EpubService';
import { EpubChunkService } from './EpubChunkService';

/** 마지막 변경 후 이 시간 동안 조용하면 자동 저장 */
const AUTO_SAVE_DEBOUNCE_MS = 3000;
/** 변경이 계속 이어져도(번역 진행 중) 이 간격마다는 저장 */
const AUTO_SAVE_MAX_WAIT_MS = 10000;

export interface RestoreResult {
  mode: 'text' | 'epub';
  restoredChunks: number;
  droppedChunks: number;
}

/** 원본 파일 읽기 결과 */
export interface SourceContent {
  content?: string;
  data?: ArrayBuffer;
}

/** 메모리에 있는 파일 → 해시 (같은 파일을 매번 다시 해싱하지 않는다) */
const hashCache = new WeakMap<object, string>();

function toSourceMap(sources: SourcePayload[]): Map<string, SourceContent> {
  return new Map(sources.map((s) => [s.ref.fileHash, { content: s.content, data: s.data }]));
}

function resolveSnapshotBaseName(snapshot: ProjectSnapshot): string {
  const fallback = snapshot.source_files[0]?.name?.replace(/\.[^/.]+$/, '') || snapshot.project.title || 'project_snapshot';
  return resolveOutputFileName(snapshot.project.outputFileNamePattern, snapshot.project, fallback);
}

export class SnapshotService {
  // 자동 저장 세션: 이 id의 자동 스냅샷을 제자리에서 갱신한다. null이면 다음 저장 때 새로 만든다.
  private static activeAutoId: string | null = null;
  private static autoTimer: ReturnType<typeof setTimeout> | null = null;
  private static firstPendingAt: number | null = null;
  private static savingPromise: Promise<unknown> | null = null;
  private static pendingAfterSave = false;
  private static enabled = true;
  private static textRangeCache: { files: FileContent[]; chunkSize: number; ranges: Array<[number, number]> } | null = null;

  // ───────────────────────── 스냅샷 만들기 ─────────────────────────

  /**
   * 저장할 내용이 있는지 (빈 새 프로젝트는 자동 저장하지 않는다)
   */
  static hasMeaningfulState(): boolean {
    const { inputFiles, results } = useTranslationStore.getState();
    const project = useProjectStore.getState().project;
    const glossaryCount = useGlossaryStore.getState().entries.length;
    const projectTouched =
      project.title !== DEFAULT_PROJECT_METADATA.title ||
      Boolean(project.originalCoverImage || project.modifiedCoverImage || project.description || project.memo);
    return inputFiles.length > 0 || results.length > 0 || glossaryCount > 0 || projectTouched;
  }

  /**
   * 현재 스토어 상태로 스냅샷을 만든다.
   * @param includeAllSources false면 이미 저장소에 있는 원본은 내용 없이 참조만 넘긴다
   */
  static async buildCurrentSnapshot(includeAllSources = true): Promise<{ snapshot: ProjectSnapshot; sources: SourcePayload[] }> {
    const { inputFiles, results, translationMode } = useTranslationStore.getState();
    const config = useSettingsStore.getState().config;
    const project = useProjectStore.getState().project;
    const glossaryEntries = useGlossaryStore.getState().entries;

    const isEpub = Boolean(inputFiles[0]?.isEpub);
    const sources: SourcePayload[] = [];

    if (isEpub) {
      const file = inputFiles[0];
      if (file.epubFile) {
        let hash = hashCache.get(file.epubFile);
        // 바이너리는 해시를 처음 계산할 때나 원본을 저장해야 할 때만 읽는다
        const data = !hash || includeAllSources ? await file.epubFile.arrayBuffer() : undefined;
        if (!hash) {
          hash = await calculateBinaryHash(data!);
          hashCache.set(file.epubFile, hash);
        }
        const ref: SnapshotSourceRef = {
          fileHash: hash,
          name: file.name,
          size: file.size || file.epubFile.size,
          lastModified: file.lastModified,
          kind: 'epub',
        };
        sources.push(includeAllSources ? { ref, data } : { ref });
      }
    } else {
      for (const file of inputFiles) {
        let hash = hashCache.get(file);
        if (!hash) {
          hash = await calculateContentHash(file.content);
          hashCache.set(file, hash);
        }
        const ref: SnapshotSourceRef = {
          fileHash: hash,
          name: file.name,
          size: file.content.length,
          lastModified: file.lastModified,
          kind: 'text',
        };
        sources.push(includeAllSources ? { ref, content: file.content } : { ref });
      }
    }

    const chunkRanges = !isEpub && translationMode === 'basic' ? this.getTextChunkRanges(inputFiles, config.chunkSize) : null;
    const translatedChunks = buildTranslatedChunks(results, chunkRanges);
    const progress = useTranslationStore.getState().progress;

    const snapshot = createEmptySnapshot({
      mode: isEpub ? 'epub' : 'text',
      translation_mode: translationMode,
      source_files: sources.map((s) => s.ref),
      config: { ...config },
      project: { ...project },
      glossary_entries: glossaryEntries.map((e) => ({ ...e })),
      progress: {
        total_chunks: Math.max(progress?.totalChunks ?? 0, results.length),
        successful_chunks: results.filter((r) => r.success).length,
        failed_chunks: results.filter((r) => !r.success).length,
      },
      translated_chunks: translatedChunks,
    });

    if (isEpub) {
      const chapters = inputFiles[0]?.epubChapters ?? [];
      snapshot.epub_structure = {
        chapters: chapters.map((ch: any) => ({
          id: ch.id || '',
          filename: ch.fileName || ch.filename || '',
          nodeCount: ch.nodes?.length || 0,
        })),
      };
    }

    return { snapshot, sources };
  }

  // 원문이 바뀌지 않았으면 청크 오프셋을 다시 계산하지 않는다
  private static getTextChunkRanges(files: FileContent[], chunkSize: number): Array<[number, number]> | null {
    if (files.length === 0) return null;
    const cache = this.textRangeCache;
    if (cache && cache.files === files && cache.chunkSize === chunkSize) return cache.ranges;
    const fullText = files.map((f) => f.content).join('\n\n');
    const ranges = computeTextChunkRanges(fullText, chunkSize);
    this.textRangeCache = { files, chunkSize, ranges };
    return ranges;
  }

  /**
   * 원본이 저장소에 이미 있으면 내용을 다시 넘기지 않고, 없다고 하면 내용을 담아 다시 저장한다
   */
  private static async persist(
    options: { id?: string; type: 'auto' | 'manual'; label?: string }
  ): Promise<SnapshotMeta> {
    const lean = await this.buildCurrentSnapshot(false);
    try {
      return await SnapshotStorage.saveSnapshot(lean.snapshot, lean.sources, options);
    } catch (error) {
      if (!(error instanceof SourceMissingError)) throw error;
      const full = await this.buildCurrentSnapshot(true);
      return await SnapshotStorage.saveSnapshot(full.snapshot, full.sources, options);
    }
  }

  // ───────────────────────── 수동 저장 ─────────────────────────

  static async saveManualSnapshot(label?: string): Promise<SnapshotMeta> {
    const meta = await this.persist({ type: 'manual', label });
    this.notifyChanged();
    return meta;
  }

  // ───────────────────────── 자동 저장 ─────────────────────────

  /**
   * 상태가 바뀌었음을 알린다. 짧은 시간 안의 변경은 묶어서 한 번만 저장한다.
   */
  static requestAutoSave(): void {
    if (!this.enabled) return;
    const now = Date.now();
    if (this.firstPendingAt === null) this.firstPendingAt = now;
    if (this.autoTimer) clearTimeout(this.autoTimer);

    const waitedSoFar = now - this.firstPendingAt;
    const delay = Math.max(0, Math.min(AUTO_SAVE_DEBOUNCE_MS, AUTO_SAVE_MAX_WAIT_MS - waitedSoFar));
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      void this.runAutoSave();
    }, delay);
  }

  /** 예약된 자동 저장을 취소한다 (복원 직후처럼 방금 불러온 상태를 다시 저장할 필요가 없을 때) */
  static cancelPendingAutoSave(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.firstPendingAt = null;
  }

  /** 예약된 자동 저장이 있으면 지금 실행하고 끝날 때까지 기다린다 */
  static async flushAutoSnapshot(): Promise<void> {
    const hadPending = this.autoTimer !== null;
    this.cancelPendingAutoSave();
    if (this.savingPromise) await this.savingPromise.catch(() => undefined);
    if (hadPending) await this.runAutoSave();
  }

  /**
   * 다음 자동 저장부터 새 스냅샷에 쓴다. 남은 변경은 먼저 현재 스냅샷에 기록한다.
   * 번역 시작·프로젝트 전환 직전에 불러 이전 상태를 별도 스냅샷으로 남긴다.
   */
  static async beginNewAutoSession(): Promise<void> {
    await this.flushAutoSnapshot();
    this.activeAutoId = null;
  }

  private static async runAutoSave(): Promise<void> {
    if (this.savingPromise) {
      this.pendingAfterSave = true;
      return;
    }
    this.firstPendingAt = null;
    if (!this.hasMeaningfulState()) return;

    const isNewRecord = this.activeAutoId === null;
    const task = (async () => {
      const meta = await this.persist({ id: this.activeAutoId ?? undefined, type: 'auto' });
      this.activeAutoId = meta.id;
      if (isNewRecord) {
        await SnapshotStorage.pruneAutoSnapshots(meta.projectId, meta.id);
      }
      this.notifyChanged();
    })();

    this.savingPromise = task;
    try {
      await task;
    } catch (error) {
      console.warn('[SnapshotService] 자동 스냅샷 저장 실패:', error);
    } finally {
      this.savingPromise = null;
      if (this.pendingAfterSave) {
        this.pendingAfterSave = false;
        this.requestAutoSave();
      }
    }
  }

  /** 테스트 전용: 자동 저장 상태 초기화 */
  static resetForTests(): void {
    this.cancelPendingAutoSave();
    this.activeAutoId = null;
    this.savingPromise = null;
    this.pendingAfterSave = false;
    this.enabled = true;
    this.textRangeCache = null;
  }

  // 스냅샷 탭이 목록을 새로 그리도록 알린다
  private static notifyChanged(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('btg-snapshots-changed'));
    }
  }

  // ───────────────────────── 파일 내보내기·가져오기 ─────────────────────────

  /** 보관함의 스냅샷을 ZIP으로 내려받는다 */
  static async exportStoredSnapshotAsZip(id: string): Promise<string | null> {
    const loaded = await SnapshotStorage.loadSnapshot(id);
    if (!loaded) return null;
    const blob = await SnapshotZipService.exportToZip(loaded.snapshot, loaded.sources);
    const fileName = `${resolveSnapshotBaseName(loaded.snapshot)}.zip`;
    triggerDownload(blob, fileName);
    return fileName;
  }

  /** 현재 작업 상태를 ZIP으로 내려받는다 */
  static async exportCurrentAsZip(): Promise<string> {
    const { snapshot, sources } = await this.buildCurrentSnapshot(true);
    const blob = await SnapshotZipService.exportToZip(snapshot, toSourceMap(sources));
    const fileName = `${resolveSnapshotBaseName(snapshot)}.zip`;
    triggerDownload(blob, fileName);
    return fileName;
  }

  /** ZIP/JSON 스냅샷 파일을 보관함에 수동 스냅샷으로 추가한다 */
  static async importFileToArchive(file: File): Promise<SnapshotMeta> {
    const { snapshot, sources } = await SnapshotZipService.parseSnapshotFile(file);
    const meta = await SnapshotStorage.saveSnapshot(snapshot, sources, { type: 'manual', label: `가져옴: ${file.name}` });
    this.notifyChanged();
    return meta;
  }

  /** ZIP/JSON 스냅샷 파일로 바로 작업을 복원한다 */
  static async restoreFromFile(file: File): Promise<RestoreResult> {
    const { snapshot, sources } = await SnapshotZipService.parseSnapshotFile(file);
    return this.applySnapshot(snapshot, toSourceMap(sources));
  }

  // ───────────────────────── 복원 ─────────────────────────

  static async restoreSnapshotById(id: string): Promise<RestoreResult | null> {
    const loaded = await SnapshotStorage.loadSnapshot(id);
    if (!loaded) return null;
    return this.applySnapshot(loaded.snapshot, loaded.sources);
  }

  /**
   * 스냅샷 내용을 모든 스토어에 적용한다
   */
  static async applySnapshot(
    snapshot: ProjectSnapshot,
    sources: Map<string, StoredSourceFile | SourceContent>
  ): Promise<RestoreResult> {
    // 복원 중 스토어 변경이 이전 세션 스냅샷을 덮어쓰지 않도록 먼저 기록을 마무리하고 끊는다
    await this.beginNewAutoSession();
    this.enabled = false;

    try {
      const config = normalizeConfig(snapshot.config);
      const project = { ...createDefaultProjectMetadata(), ...snapshot.project };
      const addLog = useTranslationStore.getState().addLog;

      let files: FileContent[] = [];
      let results: TranslationResult[] = [];
      let totalChunks = 0;
      let translatedText = '';
      let droppedChunks = 0;

      if (snapshot.mode === 'epub') {
        const ref = snapshot.source_files.find((s) => s.kind === 'epub');
        const data = ref ? sources.get(ref.fileHash)?.data : undefined;
        if (!ref || !data) {
          throw new Error('스냅샷에 EPUB 원본이 없어 복원할 수 없습니다.');
        }
        const epubFile = new File([data], ref.name || 'restored.epub', { type: 'application/epub+zip' });
        const chapters = await new EpubService().parseEpubFile(epubFile);
        files = [{
          name: ref.name,
          content: `[EPUB File] ${chapters.length} chapters loaded`,
          size: ref.size,
          lastModified: ref.lastModified,
          epubFile,
          epubChapters: chapters,
          isEpub: true,
        }];

        const allNodes = chapters.flatMap((ch: any) => ch.nodes);
        const nodeChunks = new EpubChunkService(config.chunkSize, config.epubMaxNodesPerChunk).splitEpubNodesIntoChunks(allNodes);
        totalChunks = nodeChunks.length;
        for (const [key, chunk] of Object.entries(snapshot.translated_chunks)) {
          const idx = Number(key);
          if (!nodeChunks[idx]) {
            droppedChunks++;
            continue;
          }
          results.push({
            chunkIndex: idx,
            originalText: nodeChunks[idx].map((n) => n.content || '').join('\n\n'),
            translatedText: chunk.translated_text,
            translatedSegments: chunk.translated_segments,
            success: chunk.status === 'completed',
            error: chunk.error,
          });
        }
      } else {
        const missing: string[] = [];
        for (const ref of snapshot.source_files) {
          const content = sources.get(ref.fileHash)?.content;
          if (content === undefined) {
            missing.push(ref.name);
            continue;
          }
          files.push({ name: ref.name, content, size: ref.size, lastModified: ref.lastModified });
        }
        if (missing.length > 0) {
          addLog('warning', `스냅샷 원본 파일 ${missing.length}개를 찾지 못했습니다: ${missing.join(', ')}`);
        }

        if (files.length > 0) {
          const fullText = files.map((f) => f.content).join('\n\n');
          const restored = restoreTextResults(fullText, snapshot.translated_chunks, snapshot.translation_mode, config);
          results = restored.results;
          totalChunks = restored.totalChunks;
          translatedText = restored.translatedText;
          droppedChunks = restored.droppedChunks;
        }
      }

      results.sort((a, b) => a.chunkIndex - b.chunkIndex);
      const successful = results.filter((r) => r.success).length;
      const failed = results.length - successful;
      const progress: TranslationJobProgress = {
        totalChunks: Math.max(totalChunks, results.length),
        processedChunks: results.length,
        successfulChunks: successful,
        failedChunks: failed,
        currentStatusMessage: '스냅샷에서 복원됨. 번역 시작을 누르면 남은 청크를 이어서 번역합니다.',
      };

      // 모든 계산이 끝난 뒤 한 번에 적용해, 중간에 실패하면 현재 작업이 반쯤 바뀐 채로 남지 않게 한다
      useSettingsStore.getState().setConfig(config);
      useProjectStore.getState().setProject(project);
      const glossary = useGlossaryStore.getState();
      glossary.deselectAll();
      glossary.setEntries(snapshot.glossary_entries ?? []);
      const translation = useTranslationStore.getState();
      translation.resetWork();
      translation.setTranslationMode(snapshot.translation_mode);
      translation.restoreSession(files, results, progress);
      if (snapshot.mode === 'text') {
        translation.setTranslatedText(translatedText);
      }

      if (droppedChunks > 0) {
        addLog('warning', `원문 위치를 맞추지 못한 번역 청크 ${droppedChunks}개는 복원하지 않았습니다.`);
      }
      addLog('info', `💾 스냅샷 복원 완료: "${project.title}" (청크 ${results.length}개, 성공 ${successful}개)`);

      return { mode: snapshot.mode, restoredChunks: results.length, droppedChunks };
    } finally {
      // 방금 불러온 상태를 곧바로 다시 저장하지 않는다. 다음 변경부터 새 자동 스냅샷에 기록한다.
      this.cancelPendingAutoSave();
      this.enabled = true;
    }
  }
}
