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
  etaSeconds?: number; // 남은 예상 시간 (초)
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
  etaSeconds?: number; // 남은 예상 시간 (초)
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
/**
 * 파일 내용 (텍스트 또는 EPUB)
 */
export interface FileContent {
  name: string;
  content: string;
  size: number;
  lastModified: number;
  // Phase 4-5: EPUB 지원
  epubFile?: File;           // 원본 EPUB File 객체
  epubChapters?: any[];      // EpubChapter[] 타입 (순환 참조 방지)
  isEpub?: boolean;          // EPUB 파일 여부
}

/**
 * 로그 항목
 */
export interface LogEntry {
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  timestamp: Date;
}

/**
 * EPUB 구조 정보 (스냅샷에 저장될 메타데이터)
 */
export interface EpubStructureMetadata {
  chapters: {
    id: string;
    filename: string;
    nodeCount: number;
  }[];
}

/**
 * 작업 이어하기(Resume)를 위한 스냅샷 데이터 구조 (Snake Case)
 * 외부 호환성을 위해 스네이크 케이스를 사용합니다.
 */
export interface TranslationSnapshot {
  meta: {
    version: string;
    created_at: string;
    app_version: string;
  };
  source_info: {
    file_name: string;
    file_size: number;
  };
  config: {
    chunk_size: number;
    model_name: string;
    prompt_template?: string;
    // 추가 설정 파라미터
    temperature?: number;
    requests_per_minute?: number;
    max_workers?: number;
    
    // 프리필 설정
    enable_prefill_translation?: boolean;
    prefill_system_instruction?: string;
    prefill_cached_history?: any[]; // PrefillHistoryItem[]

    // 용어집 설정
    enable_dynamic_glossary_injection?: boolean;
    max_glossary_entries_per_chunk_injection?: number;
    max_glossary_chars_per_chunk_injection?: number;

    // EPUB 설정
    enable_image_annotation?: boolean;
  };
  // Phase 5: 번역 모드 (text 또는 epub)
  mode?: 'text' | 'epub';
  source_text: string;
  progress: {
    total_chunks: number;
    processed_chunks: number;
  };
  translated_chunks: Record<string, {
    original_text: string;
    translated_text: string;
    status: string;
  }>;
  // Phase 5: EPUB 모드 시 필요한 구조 정보
  epub_structure?: EpubStructureMetadata;
  // Phase 5: EPUB 바이너리 (Base64 인코딩)
  epub_binary?: string;
}