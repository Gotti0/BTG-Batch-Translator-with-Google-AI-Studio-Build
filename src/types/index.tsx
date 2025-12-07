// types/index.ts
// 타입 정의 통합 export

export type {
  ModelInfo,
  ChunkStatusType,
  TranslationChunkStatus,
  TranslationJobProgress,
  GlossaryEntry,
  GlossaryExtractionProgress,
  TranslationResult,
  QualityIssueType,
  QualityIssue,
  FileContent,
  LogEntry,
} from './dtos';

export type {
  PrefillHistoryItem,
  AppConfig,
} from './config';

export {
  DEFAULT_PREFILL_SYSTEM_INSTRUCTION,
  DEFAULT_PREFILL_CACHED_HISTORY,
  DEFAULT_PROMPTS,
  DEFAULT_GLOSSARY_EXTRACTION_PROMPT,
  defaultConfig,
  loadConfig,
  saveConfig,
  exportConfig,
  importConfig,
} from './config';
