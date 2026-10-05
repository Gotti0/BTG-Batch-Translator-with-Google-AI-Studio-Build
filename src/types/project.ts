// src/types/project.ts
// 프로젝트 메타데이터 인터페이스 및 표지 생성/수정용 기본 프롬프트 템플릿 정의 (HOW, WHAT)
// USER 요구사항: 원본/수정 3:4 표지 이미지 관리, 이미지 모델 및 프롬프트 템플릿 지원 (WHY)
// 50MB 대용량 소설 환경에서 메타데이터와 표지 상태를 안정적으로 유지하기 위해 구현되었습니다. (WHY)

export type CoverImageThinkingLevel = 'MINIMAL' | 'HIGH';

// 원본 표지 이미지가 첨부되어 있을 때 사용할 표지 수정 기본 프롬프트 템플릿 (HOW, WHAT)
// USER 요구: 모델이 텍스트 설명만 반환하고 이미지 생성을 건너뛰지 않도록 결과 이미지 직접 생성을 강제 (WHY)
export const DEFAULT_COVER_IMAGE_PROMPT_WITH_ORIGINAL = `당신은 주어지는 외국의 웹소설 이미지를 한국어로 수정해야 한다.

웹소설에 대한 정보는 다음과 같다. 이 정보를 무조건 준수하라. 임의로 수정해서는 안 된다:
- 작가: {{author}}
- 제목: {{translated_title}}

다음의 조건 하에 이미지를 수정하라.
- 작가와 제목은 주어진 것을 무조건 준수하라. 한글로 적혀있으면 한글로 옮겨야지, 한자로 바꾼다거나 하는 행위를 금지한다.
- 원본 이미지 비율을 따른다.
- 원본 이미지 해상도가 낮은 경우 자연스럽게 업스케일링하라.
- 원본의 타이포그라피 디자인을 최대한 따르라.
- 설명이나 텍스트로만 답변하지 말고, 반드시 수정 완료된 결과 이미지를 직접 생성하여 반환하라. 텍스트 설명문만 출력하는 것을 금지한다.`;

// 원본 표지 이미지가 없을 때 본문 기반 신규 표지 생성 기본 프롬프트 템플릿 (HOW, WHAT)
// USER 요구: 텍스트 답변 대신 3:4 비율의 표지 이미지가 직접 출력되도록 결과물 형식을 강제 (WHY)
export const DEFAULT_COVER_IMAGE_PROMPT_WITHOUT_ORIGINAL = `당신은 주어지는 정보를 바탕으로 웹소설 표지 이미지를 생성해야 한다.

웹소설에 대한 정보는 다음과 같다. 이 정보를 무조건 준수하라. 임의로 수정해서는 안 된다:
- 작가: {{author}}
- 제목: {{translated_title}}
- 소개: {{description}}

소설의 앞부분 내용은 다음과 같다.
# NOVEL BEGIN
{{slot:100000}}
# NOVEL END

다음의 조건 하에 표지를 생성하라. 
- 작가와 제목은 주어진 것을 무조건 준수하라. 한글로 적혀있으면 한글로 옮겨야지, 한자로 바꾼다거나 하는 행위를 금지한다.
- 표지 비율은 가로 3:4 세로
- 설명이나 텍스트로만 답변하지 말고, 반드시 생성된 결과 이미지를 직접 생성하여 반환하라. 텍스트 설명문만 출력하는 것을 금지한다.`;


export interface ProjectMetadata {
  projectId: string; // 고유 해시/ID (동일 프로젝트 스냅샷 판정용)
  createdAt: string; // ISO 문자열
  title: string; // 프로젝트 제목 (기본값: '빈 프로젝트')
  originalTitle: string; // 프로젝트 원제 (기본값: '无标')
  author: string; // 프로젝트 저자 (기본값: 'Author')
  episodeRange: string; // 프로젝트 화수 (기본값: '1', 문자열)
  description: string; // 프로젝트 소개문 (기본값: '')
  memo: string; // 프로젝트 메모 (기본값: '')
  outputFileNamePattern: string; // 프로젝트 출력파일명 패턴 (기본값: '{{original_title}} - {{translated_title}} {{episode_range}}')

  // 표지 썸네일 이미지 관리
  originalCoverImage?: string; // 원본 이미지 데이터 URL (Base64)
  modifiedCoverImage?: string; // AI 수정/생성 이미지 데이터 URL (Base64)
  coverImageModel?: string; // 이미지 모델명 (기본: gemini-3.1-flash-lite-image)
  coverImageThinkingLevel?: CoverImageThinkingLevel; // 이미지 모델 Thinking Level ('MINIMAL' | 'HIGH', 기본: 'HIGH')
  coverImagePromptWithOriginal?: string; // 원본 이미지 존재 시 프롬프트 템플릿
  coverImagePromptWithoutOriginal?: string; // 원본 이미지 부재 시 프롬프트 템플릿
}

export const DEFAULT_PROJECT_OUTPUT_PATTERN = '{{original_title}} - {{translated_title}} {{episode_range}}';

export const DEFAULT_PROJECT_METADATA: Omit<ProjectMetadata, 'projectId' | 'createdAt'> = {
  title: '빈 프로젝트',
  originalTitle: '无标',
  author: 'Author',
  episodeRange: '1',
  description: '',
  memo: '',
  outputFileNamePattern: DEFAULT_PROJECT_OUTPUT_PATTERN,
  originalCoverImage: undefined,
  modifiedCoverImage: undefined,
  coverImageModel: 'gemini-3.1-flash-lite-image',
  coverImageThinkingLevel: 'HIGH',
  coverImagePromptWithOriginal: DEFAULT_COVER_IMAGE_PROMPT_WITH_ORIGINAL,
  coverImagePromptWithoutOriginal: DEFAULT_COVER_IMAGE_PROMPT_WITHOUT_ORIGINAL,
};

/**
 * 고유 프로젝트 해시/ID를 생성합니다.
 * - HOW: 현재 시각 밀리초 + 난수 문자열 조합
 * - WHY: 프로젝트 식별자 생성
 */
export function generateProjectHash(): string {
  const rand = Math.random().toString(36).substring(2, 9);
  const time = Date.now().toString(36);
  return `${time}${rand}`;
}

/**
 * 깨끗한 새 프로젝트 메타데이터를 생성합니다.
 * - HOW: DEFAULT_PROJECT_METADATA에 고유 ID 및 생성시각 부여
 * - WHY: 새 프로젝트 초기화
 */
export function createDefaultProjectMetadata(): ProjectMetadata {
  return {
    ...DEFAULT_PROJECT_METADATA,
    projectId: generateProjectHash(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * 플레이스홀더를 치환하여 실제 출력 파일명을 산출합니다.
 * - HOW: 템플릿 문자열 내 {{...}} 플레이스홀더를 프로젝트 정보로 교체 및 파일명 특수문자 제거
 * - WHY: 사용자 지정 패턴에 따른 안전한 파일명 생성
 */
export function resolveOutputFileName(
  pattern: string | undefined,
  project: Partial<ProjectMetadata> | Record<string, any> | undefined,
  defaultFallback: string = 'translated_output'
): string {
  const p = (project || {}) as any;
  let template = (pattern && pattern.trim()) || p.outputFileNamePattern || p.output_filename_pattern || DEFAULT_PROJECT_OUTPUT_PATTERN;
  
  // 개행을 단일 공백으로 치환
  const rawMemo = p.memo || '';
  const memoSanitized = rawMemo.replace(/\r?\n+/g, ' ').trim();
  const rawDesc = p.description || '';
  const descSanitized = rawDesc.replace(/\r?\n+/g, ' ').trim();
  const originalTitle = p.originalTitle ?? p.original_title ?? '';
  const translatedTitle = p.title ?? p.translatedTitle ?? p.translated_title ?? '';
  const author = p.author ?? '';
  const episodeRange = p.episodeRange ?? p.episode_range ?? '';

  let resolved = template
    .replace(/\{\{\s*original_title\s*\}\}/g, String(originalTitle))
    .replace(/\{\{\s*translated_title\s*\}\}/g, String(translatedTitle))
    .replace(/\{\{\s*author\s*\}\}/g, String(author))
    .replace(/\{\{\s*episode_range\s*\}\}/g, String(episodeRange))
    .replace(/\{\{\s*description\s*\}\}/g, String(descSanitized))
    .replace(/\{\{\s*memo\s*\}\}/g, String(memoSanitized));

  // 불필요한 연속 공백 정리
  resolved = resolved.replace(/\s+/g, ' ').trim();

  // 파일명으로 사용 불가능한 특수문자 치환 (Windows/Unix 호환)
  resolved = resolved.replace(/[\/\\:*?"<>|]/g, '_').trim();

  return resolved || defaultFallback;
}
