// services/snapshotFormat.ts
// 스냅샷과 앱 상태 사이의 변환, 그리고 다른 형식(원본 앱의 이전 JSON 스냅샷, 포크 앱의 ZIP)과의 필드 매핑

import { defaultConfig, type AppConfig } from '../types/config';
import type { GlossaryEntry, TranslationResult } from '../types/dtos';
import { createDefaultProjectMetadata, type ProjectMetadata } from '../types/project';
import type { ProjectSnapshot, SnapshotChunk, SnapshotTranslationMode } from '../types/snapshot';
import { ChunkService } from './ChunkService';
import { EpubChunkService } from './EpubChunkService';
import { TextNodeService, type TextNode } from './TextNodeService';

/**
 * 스네이크 케이스 설정 키 ↔ AppConfig 키.
 * 원본 앱의 이전 JSON 스냅샷과 포크 앱 ZIP의 config.json이 이 이름을 쓴다.
 */
const SNAKE_CONFIG_KEYS: Array<[string, keyof AppConfig]> = [
  ['model_name', 'modelName'],
  ['temperature', 'temperature'],
  ['top_p', 'topP'],
  ['enable_thinking', 'enableThinking'],
  ['thinking_budget', 'thinkingBudget'],
  ['thinking_level', 'thinkingLevel'],
  ['chunk_size', 'chunkSize'],
  ['requests_per_minute', 'requestsPerMinute'],
  ['max_workers', 'maxWorkers'],
  ['epub_max_nodes_per_chunk', 'epubMaxNodesPerChunk'],
  ['enable_image_annotation', 'enableImageAnnotation'],
  ['prompt_template', 'prompts'],
  ['enable_prefill_translation', 'enablePrefillTranslation'],
  ['prefill_system_instruction', 'prefillSystemInstruction'],
  ['prefill_cached_history', 'prefillCachedHistory'],
  ['enable_dynamic_glossary_injection', 'enableDynamicGlossaryInjection'],
  ['max_glossary_entries_per_chunk_injection', 'maxGlossaryEntriesPerChunkInjection'],
  ['max_glossary_chars_per_chunk_injection', 'maxGlossaryCharsPerChunkInjection'],
  ['glossary_extraction_prompt', 'glossaryExtractionPrompt'],
  ['enable_sound_notification', 'enableSoundNotification'],
  ['enable_silent_audio_loop', 'enableSilentAudioLoop'],
  ['enable_pdf_input', 'enablePdfInput'],
  ['pdf_input_mode', 'pdfInputMode'],
  ['download_debug_pdf', 'downloadDebugPdf'],
  ['epub_split_mode', 'epubSplitMode'],
  ['epub_delimiter_regex', 'epubDelimiterRegex'],
  ['epub_delimiter_min_distance', 'epubDelimiterMinDistance'],
  ['attach_glossary_to_end', 'attachGlossaryToEnd'],
];

/**
 * 저장된 설정을 현재 기본값과 합친다 (새로 생긴 필드는 기본값으로 채움)
 */
export function normalizeConfig(raw: Partial<AppConfig> | undefined): AppConfig {
  return { ...defaultConfig, ...(raw ?? {}) };
}

/**
 * 스네이크 케이스 설정을 AppConfig로 바꾼다.
 * 포크 앱은 프리필을 시스템 지침과 퓨샷 예시로 나눴으므로 그쪽 필드도 프리필로 되돌려 읽는다.
 */
export function configFromSnakeCase(raw: Record<string, any> | undefined): Partial<AppConfig> {
  if (!raw) return {};
  const config: Record<string, any> = {};
  for (const [snake, camel] of SNAKE_CONFIG_KEYS) {
    if (raw[snake] !== undefined) config[camel] = raw[snake];
    else if (raw[camel] !== undefined) config[camel] = raw[camel];
  }

  if (config.enablePrefillTranslation === undefined) {
    const fromSplit = raw.enable_system_instruction ?? raw.enable_few_shot;
    if (fromSplit !== undefined) config.enablePrefillTranslation = Boolean(raw.enable_system_instruction || raw.enable_few_shot);
  }
  if (config.prefillSystemInstruction === undefined && typeof raw.system_instruction === 'string') {
    config.prefillSystemInstruction = raw.system_instruction;
  }
  if (config.prefillCachedHistory === undefined && Array.isArray(raw.few_shot_examples)) {
    config.prefillCachedHistory = raw.few_shot_examples;
  }
  return config as Partial<AppConfig>;
}

/**
 * AppConfig를 스네이크 케이스로 바꾼다 (포크 앱이 ZIP을 읽을 수 있도록)
 */
export function configToSnakeCase(config: AppConfig): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [snake, camel] of SNAKE_CONFIG_KEYS) {
    result[snake] = config[camel];
  }
  // 포크 앱은 시스템 지침과 퓨샷 예시를 나눠 읽는다
  result.enable_system_instruction = config.enablePrefillTranslation;
  result.system_instruction = config.prefillSystemInstruction;
  result.enable_few_shot = config.enablePrefillTranslation;
  result.few_shot_examples = config.prefillCachedHistory;
  return result;
}

/**
 * 스네이크/카멜 케이스가 섞인 프로젝트 정보를 ProjectMetadata로 바꾼다
 */
export function projectFromRaw(raw: Record<string, any> | undefined): ProjectMetadata {
  const base = createDefaultProjectMetadata();
  if (!raw) return base;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) return raw[k];
    }
    return undefined;
  };
  return {
    ...base,
    projectId: pick('projectId', 'project_id', 'id') ?? base.projectId,
    createdAt: pick('createdAt', 'created_at') ?? base.createdAt,
    title: pick('title') ?? base.title,
    originalTitle: pick('originalTitle', 'original_title') ?? base.originalTitle,
    author: pick('author') ?? base.author,
    episodeRange: String(pick('episodeRange', 'episode_range') ?? base.episodeRange),
    description: pick('description') ?? base.description,
    memo: pick('memo') ?? base.memo,
    outputFileNamePattern: pick('outputFileNamePattern', 'output_filename_pattern') ?? base.outputFileNamePattern,
    originalCoverImage: pick('originalCoverImage', 'original_cover_image'),
    modifiedCoverImage: pick('modifiedCoverImage', 'modified_cover_image'),
    coverImageModel: pick('coverImageModel', 'cover_image_model') ?? base.coverImageModel,
    coverImageThinkingLevel: pick('coverImageThinkingLevel', 'cover_image_thinking_level') ?? base.coverImageThinkingLevel,
    coverImagePromptWithOriginal: pick('coverImagePromptWithOriginal', 'cover_image_prompt_with_original') ?? base.coverImagePromptWithOriginal,
    coverImagePromptWithoutOriginal:
      pick('coverImagePromptWithoutOriginal', 'cover_image_prompt_without_original') ?? base.coverImagePromptWithoutOriginal,
  };
}

/**
 * 용어집 항목을 원본 앱 형식으로 정규화한다.
 * 포크 앱은 term/translated/occurrence_count를, 원본 앱의 JSON 내보내기는 snake_case를 쓴다.
 */
export function normalizeGlossaryEntries(raw: any[] | undefined): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: GlossaryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || item.enabled === false) continue;
    const keyword = String(item.keyword ?? item.term ?? '').trim();
    const translatedKeyword = String(item.translatedKeyword ?? item.translated_keyword ?? item.translated ?? '').trim();
    if (!keyword || !translatedKeyword) continue;
    // 앞에 나온 항목(우선순위가 높은 용어집)을 우선한다
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      keyword,
      translatedKeyword,
      targetLanguage: item.targetLanguage ?? item.target_language ?? 'ko',
      occurrenceCount: Number(item.occurrenceCount ?? item.occurrence_count ?? 0) || 0,
      id: item.id,
    });
  }
  return entries;
}

/**
 * 원문을 청크 크기로 나눴을 때 각 청크의 [시작, 끝) 오프셋.
 * ChunkService는 원문을 빈틈없이 나누므로 길이를 누적하면 된다.
 */
export function computeTextChunkRanges(fullText: string, chunkSize: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  for (const chunk of new ChunkService(chunkSize).splitTextIntoChunks(fullText)) {
    ranges.push([offset, offset + chunk.length]);
    offset += chunk.length;
  }
  return ranges;
}

/**
 * 번역 결과를 스냅샷 청크로 바꾼다.
 * chunkRanges가 있으면(기본 텍스트 모드) 길이가 맞는 청크에 원문 오프셋을 남겨 복원 시 위치를 검증한다.
 */
export function buildTranslatedChunks(
  results: TranslationResult[],
  chunkRanges?: Array<[number, number]> | null
): Record<string, SnapshotChunk> {
  const chunks: Record<string, SnapshotChunk> = {};
  for (const result of [...results].sort((a, b) => a.chunkIndex - b.chunkIndex)) {
    const chunk: SnapshotChunk = {
      status: result.success ? 'completed' : 'failed',
      translated_text: result.translatedText ?? '',
    };
    if (result.translatedSegments) chunk.translated_segments = result.translatedSegments;
    if (!result.success && result.error) chunk.error = result.error;
    const range = chunkRanges?.[result.chunkIndex];
    if (range && range[1] - range[0] === (result.originalText?.length ?? -1)) {
      chunk.char_range = range;
    }
    chunks[String(result.chunkIndex)] = chunk;
  }
  return chunks;
}

export interface RestoredTextWork {
  results: TranslationResult[];
  totalChunks: number;
  translatedText: string;
  /** 원문 위치를 맞추지 못해 버린 청크 수 */
  droppedChunks: number;
}

/**
 * 텍스트 모드 스냅샷 청크를 원문과 다시 맞춰 번역 결과로 되돌린다.
 * 원문을 현재 청크 크기로 다시 나눈 뒤, 저장된 오프셋 길이가 같은 청크만 그대로 쓴다.
 */
export function restoreTextResults(
  fullText: string,
  snapshotChunks: Record<string, SnapshotChunk>,
  translationMode: SnapshotTranslationMode,
  config: AppConfig
): RestoredTextWork {
  const entries = Object.entries(snapshotChunks)
    .map(([key, chunk]) => [Number(key), chunk] as const)
    .filter(([idx]) => Number.isInteger(idx) && idx >= 0)
    .sort((a, b) => a[0] - b[0]);

  if (translationMode === 'integrity') {
    const textNodeService = new TextNodeService();
    const { nodes, originalLines } = textNodeService.parse(fullText);
    const nodeChunks = new EpubChunkService(config.chunkSize, config.epubMaxNodesPerChunk).splitEpubNodesIntoChunks(nodes);
    const results: TranslationResult[] = [];
    const translatedNodes: TextNode[] = [];
    let dropped = 0;

    for (const [idx, chunk] of entries) {
      const chunkNodes = nodeChunks[idx] as TextNode[] | undefined;
      if (!chunkNodes) {
        dropped++;
        continue;
      }
      const segments = chunk.translated_segments;
      if (chunk.status === 'completed' && segments && segments.length === chunkNodes.length) {
        chunkNodes.forEach((node, k) => translatedNodes.push({ ...node, content: segments[k] }));
      }
      results.push({
        chunkIndex: idx,
        originalText: chunkNodes.map((n) => n.content ?? '').join('\n'),
        translatedText: chunk.translated_text,
        translatedSegments: segments,
        success: chunk.status === 'completed',
        error: chunk.error,
      });
    }

    const translatedText = textNodeService.reconstruct(
      translatedNodes.sort((a, b) => a.lineIndex - b.lineIndex),
      originalLines
    );
    return { results, totalChunks: nodeChunks.length, translatedText, droppedChunks: dropped };
  }

  const textChunks = new ChunkService(config.chunkSize).splitTextIntoChunks(fullText);
  const results: TranslationResult[] = [];
  let dropped = 0;

  for (const [idx, chunk] of entries) {
    const range = chunk.char_range;
    const rangeLength = range ? range[1] - range[0] : undefined;
    let originalText: string | undefined;

    if (textChunks[idx] !== undefined && (rangeLength === undefined || textChunks[idx].length === rangeLength)) {
      originalText = textChunks[idx];
    } else if (range && range[1] <= fullText.length) {
      // 청크 크기 설정이 바뀌었거나 다른 분할기로 만든 스냅샷: 저장된 오프셋으로 원문을 잘라 쓴다
      originalText = fullText.slice(range[0], range[1]);
    }

    if (originalText === undefined) {
      dropped++;
      continue;
    }
    results.push({
      chunkIndex: idx,
      originalText,
      translatedText: chunk.translated_text,
      translatedSegments: chunk.translated_segments,
      success: chunk.status === 'completed',
      error: chunk.error,
    });
  }

  const translatedText = results
    .filter((r) => r.success)
    .map((r) => r.translatedText)
    .join('');
  return { results, totalChunks: textChunks.length, translatedText, droppedChunks: dropped };
}

/**
 * 스냅샷 객체 기본 틀
 */
export function createEmptySnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    format: 'btg-project-snapshot',
    version: 2,
    created_at: new Date().toISOString(),
    mode: 'text',
    translation_mode: 'basic',
    source_files: [],
    config: { ...defaultConfig },
    project: createDefaultProjectMetadata(),
    glossary_entries: [],
    progress: { total_chunks: 0, successful_chunks: 0, failed_chunks: 0 },
    translated_chunks: {},
    ...overrides,
  };
}

/**
 * Base64 문자열을 ArrayBuffer로
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
