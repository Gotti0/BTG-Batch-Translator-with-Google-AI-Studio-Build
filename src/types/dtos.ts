// types/dtos.ts
// Python core/dtos.py 의 TypeScript 변환

/**
 * 사용 가능한 API 모델 정보
 */
export interface ModelInfo {
  name: string;           // 예: "models/gemini-2.0-flash"
  displayName: string;    // 예: "gemini-2.0-flash"
  description?: string;
  version?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/**
 * 개별 청크의 번역 상태
 */
export type ChunkStatusType = 'pending' | 'processing' | 'completed' | 'failed';

export interface TranslationChunkStatus {
  chunkIndex: number;
  status: ChunkStatusType;
  errorMessage?: string;
  translatedContentPreview?: string;
}

/**
 * 전체 번역 작업의 진행 상황
 */
export interface TranslationJobProgress {
  totalChunks: number;
  processedChunks: number;
  successfulChunks: number;
  failedChunks: number;
  currentStatusMessage: string;
  currentChunkProcessing?: number;
  lastErrorMessage?: string;
}

/**
 * 용어집 항목
 */
export interface GlossaryEntry {
  keyword: string;
  translatedKeyword: string;
  targetLanguage: string;
  occurrenceCount: number;
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * 용어집 추출 작업 진행 상황
 */
export interface GlossaryExtractionProgress {
  totalSegments: number;
  processedSegments: number;
  currentStatusMessage: string;
  extractedEntriesCount: number;
}

/**
 * 번역 결과
 */
export interface TranslationResult {
  chunkIndex: number;
  originalText: string;
  translatedText: string;
  success: boolean;
  error?: string;
}

/**
 * 품질 이슈 타입
 */
export type QualityIssueType = 'omission' | 'hallucination';

/**
 * 품질 검사 이슈
 */
export interface QualityIssue {
  chunkIndex: number;
  issueType: QualityIssueType;
  zScore: number;
  ratio: number;
}

/**
 * 파일 콘텐츠 정보
 */
export interface FileContent {
  name: string;
  content: string;
  size: number;
  lastModified: number;
}

/**
 * 로그 항목
 */
export interface LogEntry {
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  timestamp: Date;
}