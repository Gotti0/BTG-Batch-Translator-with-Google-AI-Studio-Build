// types/snapshot.ts
// 프로젝트 스냅샷(작업 상태 전체 보관본) 타입

import type { AppConfig } from './config';
import type { EpubStructureMetadata, GlossaryEntry } from './dtos';
import type { ProjectMetadata } from './project';

export type SnapshotType = 'auto' | 'manual';
export type SnapshotWorkMode = 'text' | 'epub';
export type SnapshotTranslationMode = 'basic' | 'integrity';

/**
 * 스냅샷이 참조하는 원본 파일. 내용은 원본 저장소에 해시 키로 한 벌만 둔다.
 */
export interface SnapshotSourceRef {
  fileHash: string;
  name: string;
  size: number;
  lastModified: number;
  kind: 'text' | 'epub';
}

/**
 * 원본 저장소 레코드
 */
export interface StoredSourceFile {
  id: string; // getSourceRecordKey(hash)
  hash: string;
  kind: 'text' | 'epub';
  /** 텍스트 원문 */
  content?: string;
  /** EPUB 바이너리 */
  data?: ArrayBuffer;
  size: number;
  savedAt: string;
}

/**
 * 저장 전, 메모리에 있는 원본 파일
 */
export interface SourcePayload {
  ref: SnapshotSourceRef;
  content?: string;
  data?: ArrayBuffer;
}

export interface SnapshotChunk {
  status: 'completed' | 'failed';
  translated_text: string;
  translated_segments?: string[];
  /** 기본 텍스트 모드에서 원문 전체 중 이 청크가 차지하는 [시작, 끝) 오프셋 */
  char_range?: [number, number];
  error?: string;
}

export interface ProjectSnapshot {
  format: 'btg-project-snapshot';
  version: 2;
  created_at: string;
  mode: SnapshotWorkMode;
  translation_mode: SnapshotTranslationMode;
  source_files: SnapshotSourceRef[];
  epub_structure?: EpubStructureMetadata;
  config: AppConfig;
  project: ProjectMetadata;
  glossary_entries: GlossaryEntry[];
  progress: {
    total_chunks: number;
    successful_chunks: number;
    failed_chunks: number;
  };
  translated_chunks: Record<string, SnapshotChunk>;
}

/**
 * 스냅샷 목록에 쓰는 가벼운 메타데이터 (본문은 따로 저장)
 */
export interface SnapshotMeta {
  id: string;
  type: SnapshotType;
  label?: string;
  createdAt: string;
  updatedAt: string;
  updateCount: number;
  projectId: string;
  projectTitle: string;
  projectAuthor: string;
  episodeRange: string;
  fileName: string;
  mode: SnapshotWorkMode;
  translationMode: SnapshotTranslationMode;
  totalChunks: number;
  successfulChunks: number;
  failedChunks: number;
  totalChars: number;
  /** 본문과 원문을 합친 대략적인 크기 */
  approxBytes: number;
  hasCover: boolean;
  modelName: string;
  sourceHashes: string[];
}
