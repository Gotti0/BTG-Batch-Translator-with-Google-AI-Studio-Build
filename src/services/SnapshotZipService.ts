// services/SnapshotZipService.ts
// 스냅샷을 ZIP 파일로 내보내고, ZIP 또는 이전 JSON 스냅샷 파일을 읽어 스냅샷으로 되돌린다.
//
// ZIP 구조는 포크 앱(Remix BTG)과 같게 맞춰 두 앱이 서로의 ZIP을 읽을 수 있게 한다.
//   manifest.json            형식·모드·프로젝트 정보·진행률
//   config.json              스네이크 케이스 설정 + app_config(이 앱의 설정 전체)
//   covers/                  표지 이미지 (원본 / 수정본)
//   source/files/, source/input_files.json   텍스트 원문 (파일별)
//   source/book.epub, source/epub_structure.json  EPUB 원본
//   chunks/{i}.json, chunks/index.json      청크별 번역 결과
//   glossaries/...           용어집

import JSZip from 'jszip';
import type { AppConfig } from '../types/config';
import type { TranslationSnapshot as LegacyTranslationSnapshot } from '../types/dtos';
import type { ProjectSnapshot, SnapshotChunk, SourcePayload, StoredSourceFile } from '../types/snapshot';
import { calculateBinaryHash, calculateContentHash } from '../utils/sourceHashUtils';
import {
  base64ToArrayBuffer,
  computeTextChunkRanges,
  configFromSnakeCase,
  configToSnakeCase,
  createEmptySnapshot,
  normalizeConfig,
  normalizeGlossaryEntries,
  projectFromRaw,
} from './snapshotFormat';

export const SNAPSHOT_ZIP_FORMAT = 'btg-snapshot-zip';

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_');
}

function dataUrlToBinary(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'png';
  return { bytes: new Uint8Array(base64ToArrayBuffer(match[2])), ext };
}

async function binaryToDataUrl(file: JSZip.JSZipObject): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
  const base64 = await file.async('base64');
  return `data:${mime};base64,${base64}`;
}

export interface ParsedSnapshotFile {
  snapshot: ProjectSnapshot;
  sources: SourcePayload[];
}

export class SnapshotZipService {
  /**
   * 스냅샷을 ZIP Blob으로 만든다
   */
  static async exportToZip(
    snapshot: ProjectSnapshot,
    sources: Map<string, StoredSourceFile | { content?: string; data?: ArrayBuffer }>
  ): Promise<Blob> {
    const zip = new JSZip();
    const { originalCoverImage, modifiedCoverImage, ...projectWithoutCovers } = snapshot.project;

    const manifestProject: Record<string, unknown> = {
      ...projectWithoutCovers,
      id: snapshot.project.projectId,
      created_at: snapshot.project.createdAt,
      original_title: snapshot.project.originalTitle,
      episode_range: snapshot.project.episodeRange,
      output_filename_pattern: snapshot.project.outputFileNamePattern,
    };
    for (const [key, image] of [['original', originalCoverImage], ['modified', modifiedCoverImage]] as const) {
      const binary = image ? dataUrlToBinary(image) : null;
      if (binary) {
        const path = `covers/${key}.${binary.ext}`;
        zip.file(path, binary.bytes);
        manifestProject[`${key}_cover_image`] = path;
      }
    }

    const translatedChunks = Object.entries(snapshot.translated_chunks).sort((a, b) => Number(a[0]) - Number(b[0]));
    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          format: SNAPSHOT_ZIP_FORMAT,
          version: '2.0',
          app_version: 'btg-ai-studio-build',
          created_at: snapshot.created_at,
          mode: snapshot.mode,
          translation_mode: snapshot.translation_mode === 'integrity' ? 'integrity' : 'speed',
          snapshot_type: 'manual',
          project: manifestProject,
          source_info: {
            file_name: snapshot.source_files[0]?.name ?? '',
            file_size: snapshot.source_files.reduce((sum, s) => sum + s.size, 0),
          },
          progress: {
            total_chunks: snapshot.progress.total_chunks,
            processed_chunks: snapshot.progress.successful_chunks,
          },
        },
        null,
        2
      )
    );

    zip.file('config.json', JSON.stringify({ ...configToSnakeCase(snapshot.config), app_config: snapshot.config }, null, 2));

    if (snapshot.mode === 'epub') {
      const ref = snapshot.source_files.find((s) => s.kind === 'epub');
      const data = ref ? sources.get(ref.fileHash)?.data : undefined;
      if (data) zip.file('source/book.epub', data);
      if (snapshot.epub_structure) {
        zip.file('source/epub_structure.json', JSON.stringify(snapshot.epub_structure, null, 2));
      }
    } else {
      const fileList: Array<Record<string, unknown>> = [];
      snapshot.source_files.forEach((ref, index) => {
        const content = sources.get(ref.fileHash)?.content ?? '';
        const path = `source/files/${String(index).padStart(2, '0')}_${sanitizeFileName(ref.name || `file_${index}.txt`)}`;
        zip.file(path, content);
        fileList.push({ index, name: ref.name, path, size: ref.size, lastModified: ref.lastModified });
      });
      zip.file('source/input_files.json', JSON.stringify(fileList, null, 2));
    }

    const index: Record<string, unknown> = {};
    for (const [key, chunk] of translatedChunks) {
      index[key] = { char_range: chunk.char_range, status: chunk.status };
      zip.file(
        `chunks/${key}.json`,
        JSON.stringify({ chunk_index: Number(key), ...chunk }, null, 2)
      );
    }
    zip.file('chunks/index.json', JSON.stringify({ version: 2, total_chunks: translatedChunks.length, chunks: index }, null, 2));

    // 포크 앱은 용어집 목록(project_glossaries)을 읽으므로 같은 항목을 그 형식으로도 함께 넣는다
    const entries = snapshot.glossary_entries;
    if (entries.length > 0) {
      zip.file('glossaries/default_entries.json', JSON.stringify(entries, null, 2));
      const projectGlossaryFile = 'glossaries/00_project_glossary.json';
      zip.file(
        projectGlossaryFile,
        JSON.stringify(
          {
            id: 'default',
            name: '프로젝트 용어집',
            type: 'project',
            enabled: true,
            entries: entries.map((e) => ({
              term: e.keyword,
              translated: e.translatedKeyword,
              occurrence_count: e.occurrenceCount,
              keyword: e.keyword,
              translatedKeyword: e.translatedKeyword,
              targetLanguage: e.targetLanguage,
              occurrenceCount: e.occurrenceCount,
            })),
          },
          null,
          2
        )
      );
      zip.file(
        'glossaries/index.json',
        JSON.stringify(
          {
            version: 2,
            project_glossaries: [{ id: 'default', name: '프로젝트 용어집', type: 'project', file: projectGlossaryFile, term_count: entries.length }],
            has_default_entries: true,
          },
          null,
          2
        )
      );
    }

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  /**
   * ZIP 또는 이전 JSON 스냅샷 파일을 읽는다
   */
  static async parseSnapshotFile(file: File | Blob): Promise<ParsedSnapshotFile> {
    if (await this.isZipFile(file)) {
      return this.importFromZip(file);
    }
    const json = JSON.parse((await file.text()).replace(/^﻿/, ''));
    if (json?.format === 'btg-project-snapshot') {
      throw new Error('이 형식은 보관함 내부 형식입니다. ZIP으로 내보낸 파일을 사용해 주세요.');
    }
    return this.fromLegacyJson(json as LegacyTranslationSnapshot);
  }

  static async isZipFile(file: File | Blob): Promise<boolean> {
    if ('name' in file && typeof file.name === 'string' && file.name.toLowerCase().endsWith('.zip')) return true;
    try {
      const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    } catch {
      return false;
    }
  }

  private static async importFromZip(file: File | Blob): Promise<ParsedSnapshotFile> {
    const zip = await JSZip.loadAsync(file);
    const readJson = async (path: string) => {
      const entry = zip.file(path);
      return entry ? JSON.parse(await entry.async('string')) : undefined;
    };

    const manifest = await readJson('manifest.json');
    if (!manifest) {
      throw new Error('BTG 스냅샷 ZIP이 아닙니다 (manifest.json 없음).');
    }

    const rawConfig = (await readJson('config.json')) ?? {};
    const config: AppConfig = rawConfig.app_config
      ? normalizeConfig(rawConfig.app_config)
      : normalizeConfig(configFromSnakeCase(rawConfig));

    const project = projectFromRaw(manifest.project);
    // 표지는 covers/ 아래 바이너리로 들어 있다 (manifest에는 경로만)
    const originalCover = zip.file(/^covers\/original\./i)[0];
    const modifiedCover = zip.file(/^covers\/modified\./i)[0];
    project.originalCoverImage = originalCover ? await binaryToDataUrl(originalCover) : undefined;
    project.modifiedCoverImage = modifiedCover ? await binaryToDataUrl(modifiedCover) : undefined;

    const mode: 'text' | 'epub' = manifest.mode === 'epub' ? 'epub' : 'text';
    const sources: SourcePayload[] = [];
    let epubStructure: ProjectSnapshot['epub_structure'];

    if (mode === 'epub') {
      const epubEntry = zip.file('source/book.epub');
      if (epubEntry) {
        const data = await epubEntry.async('arraybuffer');
        sources.push({
          ref: {
            fileHash: await calculateBinaryHash(data),
            name: manifest.source_info?.file_name || 'book.epub',
            size: data.byteLength,
            lastModified: Date.now(),
            kind: 'epub',
          },
          data,
        });
      }
      epubStructure = await readJson('source/epub_structure.json');
    } else {
      const fileList = await readJson('source/input_files.json');
      if (Array.isArray(fileList)) {
        for (const item of fileList) {
          const entry = zip.file(item.path || '') ?? (item.name ? zip.file(`source/files/${item.name}`) : null);
          if (!entry) continue;
          const content = await entry.async('string');
          sources.push({
            ref: {
              fileHash: await calculateContentHash(content),
              name: item.name || 'source.txt',
              size: content.length,
              lastModified: item.lastModified || Date.now(),
              kind: 'text',
            },
            content,
          });
        }
      }
      if (sources.length === 0) {
        const single = zip.file('source/source.txt');
        if (single) {
          const content = await single.async('string');
          sources.push({
            ref: {
              fileHash: await calculateContentHash(content),
              name: manifest.source_info?.file_name || 'source.txt',
              size: content.length,
              lastModified: Date.now(),
              kind: 'text',
            },
            content,
          });
        }
      }
    }

    const translatedChunks: Record<string, SnapshotChunk> = {};
    const chunkFiles = zip.file(/^chunks\/[0-9]+\.json$/);
    if (chunkFiles.length > 0) {
      for (const entry of chunkFiles) {
        const key = entry.name.match(/^chunks\/([0-9]+)\.json$/)![1];
        const chunk = toSnapshotChunk(JSON.parse(await entry.async('string')));
        if (chunk) translatedChunks[key] = chunk;
      }
    } else {
      const legacy = await readJson('chunks/metadata.json');
      if (legacy && typeof legacy === 'object') {
        for (const [key, data] of Object.entries(legacy)) {
          const chunk = toSnapshotChunk(data);
          if (chunk) translatedChunks[key] = chunk;
        }
      }
    }

    // 용어집: 이 앱이 쓴 default_entries.json을 먼저, 없으면 포크 앱의 용어집 목록을 우선순위대로 합친다
    let glossaryRaw: any[] | undefined = await readJson('glossaries/default_entries.json');
    if (!Array.isArray(glossaryRaw)) {
      const glossaryIndex = await readJson('glossaries/index.json');
      glossaryRaw = [];
      for (const item of glossaryIndex?.project_glossaries ?? []) {
        const glossary = item.file ? await readJson(item.file) : undefined;
        if (glossary && glossary.enabled !== false && Array.isArray(glossary.entries)) {
          glossaryRaw.push(...glossary.entries);
        }
      }
    }

    const statuses = Object.values(translatedChunks);
    const snapshot = createEmptySnapshot({
      created_at: manifest.created_at || new Date().toISOString(),
      mode,
      translation_mode: manifest.translation_mode === 'integrity' ? 'integrity' : 'basic',
      source_files: sources.map((s) => s.ref),
      epub_structure: epubStructure,
      config,
      project,
      glossary_entries: normalizeGlossaryEntries(glossaryRaw),
      progress: {
        total_chunks: Number(manifest.progress?.total_chunks) || statuses.length,
        successful_chunks: statuses.filter((c) => c.status === 'completed').length,
        failed_chunks: statuses.filter((c) => c.status === 'failed').length,
      },
      translated_chunks: translatedChunks,
    });
    return { snapshot, sources };
  }

  /**
   * 이 앱의 이전 버전이 내보낸 JSON 스냅샷(또는 이전 자동 저장 레코드)을 변환한다
   */
  static async fromLegacyJson(legacy: LegacyTranslationSnapshot): Promise<ParsedSnapshotFile> {
    if (!legacy || typeof legacy !== 'object' || !legacy.config) {
      throw new Error('유효하지 않은 스냅샷 파일입니다 (설정 정보 없음).');
    }
    const config = normalizeConfig(configFromSnakeCase(legacy.config as Record<string, any>));
    const mode: 'text' | 'epub' = legacy.mode === 'epub' ? 'epub' : 'text';
    const fileName = legacy.source_info?.file_name || (mode === 'epub' ? 'restored.epub' : 'restored_source.txt');
    const sources: SourcePayload[] = [];

    if (mode === 'epub') {
      if (!legacy.epub_binary) {
        throw new Error('EPUB 스냅샷에 원본 EPUB 데이터가 없습니다.');
      }
      const data = base64ToArrayBuffer(legacy.epub_binary);
      sources.push({
        ref: { fileHash: await calculateBinaryHash(data), name: fileName, size: data.byteLength, lastModified: Date.now(), kind: 'epub' },
        data,
      });
    } else {
      const content = legacy.source_text ?? '';
      sources.push({
        ref: { fileHash: await calculateContentHash(content), name: fileName, size: content.length, lastModified: Date.now(), kind: 'text' },
        content,
      });
    }

    // 이전 형식은 성공한 청크만 담고 오프셋이 없다. 원문을 같은 청크 크기로 다시 나눠 원문 길이가 맞는 청크에만 오프셋을 붙인다.
    const ranges = mode === 'text' ? computeTextChunkRanges(legacy.source_text ?? '', config.chunkSize) : [];
    const translatedChunks: Record<string, SnapshotChunk> = {};
    for (const [key, chunk] of Object.entries(legacy.translated_chunks ?? {})) {
      const range = ranges[Number(key)];
      const originalLength = chunk.original_text?.length;
      translatedChunks[key] = {
        status: chunk.status === 'success' || chunk.status === 'completed' ? 'completed' : 'failed',
        translated_text: chunk.translated_text ?? '',
        ...(chunk.translated_segments && { translated_segments: chunk.translated_segments }),
        ...(range && originalLength !== undefined && range[1] - range[0] === originalLength && { char_range: range }),
      };
    }

    const chunkList = Object.values(translatedChunks);
    const snapshot = createEmptySnapshot({
      created_at: legacy.meta?.created_at || new Date().toISOString(),
      mode,
      translation_mode: 'basic',
      source_files: sources.map((s) => s.ref),
      epub_structure: legacy.epub_structure,
      config,
      project: { ...projectFromRaw(undefined), title: fileName.replace(/\.[^/.]+$/, '') },
      glossary_entries: [],
      progress: {
        total_chunks: legacy.progress?.total_chunks ?? chunkList.length,
        successful_chunks: chunkList.filter((c) => c.status === 'completed').length,
        failed_chunks: chunkList.filter((c) => c.status === 'failed').length,
      },
      translated_chunks: translatedChunks,
    });
    return { snapshot, sources };
  }
}

/**
 * ZIP 청크 파일을 스냅샷 청크로 바꾼다.
 * 포크 앱은 아직 번역하지 않은 청크도 'estimated'/'queued' 상태로 넣으므로 그런 청크는 건너뛴다(이어서 번역 대상).
 */
function toSnapshotChunk(data: any): SnapshotChunk | null {
  const rawStatus = data?.status;
  let status: SnapshotChunk['status'];
  if (rawStatus === 'completed' || rawStatus === 'success') status = 'completed';
  else if (rawStatus === 'failed' || rawStatus === 'needs_retry') status = 'failed';
  else return null;
  const chunk: SnapshotChunk = {
    status,
    translated_text: data?.translated_text ?? '',
  };
  if (Array.isArray(data?.translated_segments)) chunk.translated_segments = data.translated_segments;
  if (Array.isArray(data?.char_range) && data.char_range.length === 2) chunk.char_range = [data.char_range[0], data.char_range[1]];
  if (data?.error) chunk.error = String(data.error);
  return chunk;
}
