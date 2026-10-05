// utils/epubExportUtils.ts
// 텍스트 번역본을 EPUB으로 내보낼 때 쓰는 검증, 부록 용어집 선별, 구분자 기반 챕터 분할 유틸리티

import type { ProjectMetadata } from '../types/project';
import type { GlossaryEntry } from '../types/dtos';

export interface ExportGlossaryItem {
  translated: string;
  category: string;
  term: string;
}

export interface EpubValidationResult {
  valid: boolean;
  error?: string;
  coverImage?: string;
}

// EPUB 내보내기에 필요한 표지, 메타데이터 및 청크 완료 조건을 검증합니다. (HOW, WHAT)
// USER 요구: 표지(수정/원본 중 하나 필수, 수정 우선) 및 제목/작가 필수 확인 (WHY)
export function validateEpubExportRequirements(
  project: Partial<ProjectMetadata>,
  hasCompletedChunks: boolean
): EpubValidationResult {
  if (!hasCompletedChunks) {
    return {
      valid: false,
      error: '완료된 번역 청크가 없어 EPUB 전자책을 생성할 수 없습니다.',
    };
  }

  // 1. 표지 이미지 검증: 수정/생성 이미지 우선, 없으면 원본 이미지
  const coverImage = (project.modifiedCoverImage || project.originalCoverImage || '').trim();
  if (!coverImage) {
    return {
      valid: false,
      error: 'EPUB 내보내기를 위해 표지 이미지가 필요합니다. [표지 설정]에서 이미지를 등록하거나 생성해 주세요.',
    };
  }

  // 2. 제목 검증
  const title = (project.title || '').trim();
  if (!title || title === '빈 프로젝트') {
    return {
      valid: false,
      error: 'EPUB 내보내기를 위해 소설 제목(title)을 입력해 주세요.',
    };
  }

  // 3. 작가 검증
  const author = (project.author || '').trim();
  if (!author) {
    return {
      valid: false,
      error: 'EPUB 내보내기를 위해 작가명(author)을 입력해 주세요.',
    };
  }

  return {
    valid: true,
    coverImage,
  };
}

// 용어집에서 등장 횟수가 0인 항목을 빼고 번역어 가나다순으로 정렬해 EPUB 부록용 목록을 만든다.
export function prepareGlossaryForEpubExport(entries: GlossaryEntry[] = []): ExportGlossaryItem[] {
  const seenKeywords = new Set<string>();
  const items: ExportGlossaryItem[] = [];

  for (const entry of entries) {
    const term = (entry.keyword || '').trim();
    if (!term) continue;

    // 같은 원문이 여러 번 들어 있으면 먼저 나온 항목만 쓴다
    const lower = term.toLowerCase();
    if (seenKeywords.has(lower)) continue;
    seenKeywords.add(lower);

    if ((entry.occurrenceCount ?? 1) <= 0) continue;

    items.push({
      translated: (entry.translatedKeyword || '').trim(),
      category: '',
      term,
    });
  }

  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  return items.sort((a, b) => collator.compare(a.translated, b.translated));
}

export interface SplitChapterItem {
  title: string;
  text: string;
}

// 구분자 정규표현식 및 최소 간격을 적용하여 텍스트를 개별 챕터로 분할합니다. (HOW, WHAT)
// USER 요구: 구분자 라인을 챕터 제목으로 분할, 공백 제외 최소 간격(기본 10) 미만 중복 구분자는 무시 (WHY)
export function splitTextByDelimiterChapters(
  fullText: string,
  delimiterRegexStr: string,
  minDistance: number = 10,
  defaultFirstChapterTitle: string = '서두'
): SplitChapterItem[] {
  if (!fullText || !fullText.trim()) {
    return [];
  }

  // 1. 유저 지정 정규식 유효성 검사 및 정규식 인스턴스 생성 (Multiline 'm' 플래그 필수)
  let regex: RegExp;
  try {
    const trimmedPattern = delimiterRegexStr.trim();
    if (!trimmedPattern) {
      throw new Error('정규식이 비어있습니다.');
    }
    regex = new RegExp(trimmedPattern, 'm');
  } catch (e) {
    console.warn('[splitTextByDelimiterChapters] 잘못된 정규표현식, 단일 챕터로 대체:', e);
    return [{ title: defaultFirstChapterTitle, text: fullText }];
  }

  // 2. 줄 단위 분할 및 순차 검사 (정확한 라인 단위 일치 및 메모리 절약)
  const lines = fullText.split(/\r?\n/);
  const chapters: SplitChapterItem[] = [];

  let currentTitle = '';
  let currentLines: string[] = [];
  let nonWhitespaceCharsSinceLastDelimiter = 0;
  let hasFoundFirstValidDelimiter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isMatch = regex.test(line);

    if (isMatch) {
      if (!hasFoundFirstValidDelimiter) {
        // 첫 번째 유효 구분자 등장
        if (currentLines.length > 0 && currentLines.some((l) => l.trim().length > 0)) {
          // 구분자 앞에 텍스트(프롤로그, 서두 등)가 있었던 경우 별도 챕터로 보존
          chapters.push({
            title: defaultFirstChapterTitle,
            text: currentLines.join('\n').trim(),
          });
        }
        hasFoundFirstValidDelimiter = true;
        currentTitle = line.trim() || `제 ${chapters.length + 1}장`;
        currentLines = [];
        nonWhitespaceCharsSinceLastDelimiter = 0;
      } else {
        // 두 번째 이후 구분자 등장: 최소 간격 검사 (공백 제외 문자수)
        if (nonWhitespaceCharsSinceLastDelimiter < minDistance) {
          // 간격 미만이면 중복 제목/부연 설명으로 간주하여 무시하고 본문에 흡수
          currentLines.push(line);
          const nonWs = line.replace(/[\s\u3000]/g, '').length;
          nonWhitespaceCharsSinceLastDelimiter += nonWs;
        } else {
          // 최소 간격 이상 충족: 새 챕터 시작
          chapters.push({
            title: currentTitle || `제 ${chapters.length + 1}장`,
            text: currentLines.join('\n').trim(),
          });
          currentTitle = line.trim() || `제 ${chapters.length + 1}장`;
          currentLines = [];
          nonWhitespaceCharsSinceLastDelimiter = 0;
        }
      }
    } else {
      currentLines.push(line);
      if (hasFoundFirstValidDelimiter) {
        const nonWs = line.replace(/[\s\u3000]/g, '').length;
        nonWhitespaceCharsSinceLastDelimiter += nonWs;
      }
    }
  }

  // 마지막 챕터 푸시
  if (currentLines.length > 0 || currentTitle) {
    chapters.push({
      title: currentTitle || (chapters.length === 0 ? defaultFirstChapterTitle : `제 ${chapters.length + 1}장`),
      text: currentLines.join('\n').trim(),
    });
  }

  // 모든 챕터가 비어있는 극단적인 경우 가드
  if (chapters.length === 0) {
    return [{ title: defaultFirstChapterTitle, text: fullText }];
  }

  return chapters;
}
