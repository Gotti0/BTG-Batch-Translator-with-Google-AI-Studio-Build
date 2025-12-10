/**
 * EPUB 파일 처리를 위한 핵심 타입 정의
 * HTML을 순차적인 노드 리스트로 변환하여 관리
 */

export type EpubNodeType = 'text' | 'image' | 'ignored';

/**
 * 평탄화(Flattening)된 EPUB 노드
 * HTML 구조를 순차적 리스트로 변환하여 번역 대상과 보존 대상을 분리
 */
export interface EpubNode {
  /** 고유 UUID (번역 결과 매핑 키) */
  id: string;

  /** 노드 타입: text(번역 대상), image(보존), ignored(무시) */
  type: EpubNodeType;

  /** 원래 태그 이름 (p, h1, div, img 등) */
  tag: string;

  /** 번역 대상 텍스트 (type='text'인 경우만) */
  content?: string;

  /** 보존할 원본 HTML (type='image' 또는 'ignored'인 경우) */
  html?: string;

  /** 이미지 파일 경로 (type='image'인 경우). ZIP 내부의 절대 경로로 변환하여 저장 */
  imagePath?: string;

  /** 태그 속성 (class, style 등 보존용) */
  attributes?: Record<string, string>;
}

/**
 * EPUB 챕터 단위 정보
 * 파일명과 평탄화된 노드 배열로 구성
 */
export interface EpubChapter {
  /** 내부 파일명 (예: part001.xhtml) */
  fileName: string;

  /** 평탄화된 노드 리스트 */
  nodes: EpubNode[];

  /** 원본 헤드 태그 내용 (title, meta, link 등 보존용) */
  head?: string;
}

/**
 * EPUB 파일 정보
 * ZIP 압축 해제 후 바이너리 데이터 저장
 */
export interface EpubFile {
  /** 파일명 */
  name: string;

  /** 파일 바이너리 데이터 */
  content: ArrayBuffer;
}

/**
 * EPUB OPF 매니페스트 항목
 * 책의 구성 파일 정보
 */
export interface OPFManifestItem {
  id: string;
  href: string;
  'media-type': string;
}

/**
 * EPUB OPF Spine 항목
 * 책의 읽기 순서 정보
 */
export interface OPFSpineItem {
  idref: string;
  linear?: string;
}

/**
 * EPUB 메타데이터
 * 책 정보 (제목, 저자 등)
 */
export interface EpubMetadata {
  title?: string;
  author?: string;
  language?: string;
  identifier?: string;
  publisher?: string;
  date?: string;
  description?: string;
}
