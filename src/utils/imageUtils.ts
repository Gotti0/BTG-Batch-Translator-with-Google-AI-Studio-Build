// src/utils/imageUtils.ts
// 표지 썸네일 검증, 첫 프레임 추출, 동적 종횡비 계산 및 프롬프트 치환 유틸리티 (HOW, WHAT)
// slot 정수 글자 수 검증 및 원본 이미지 비율을 Gemini 지원 표준 규격으로 매핑합니다. (HOW, WHAT)
// 대용량 소설 표지 작업 시 이미지 왜곡 방지 및 안전한 프롬프트 형식을 보장하기 위함입니다. (WHY)

import type { ProjectMetadata } from '../types/project';

/**
 * 이미지 파일(JPG, PNG, WEBP, GIF 등)을 읽어 Canvas를 통해 정적 첫 프레임 Data URL(PNG)로 변환합니다.
 * - HOW: FileReader로 Data URL 로드 후 HTML Canvas에 렌더링하여 첫 프레임 추출
 * - WHY: 움직이는 GIF/WebP 파일의 첫 프레임만 분리하고 일관된 정적 이미지 포맷으로 저장
 */
export async function extractFirstFrameFromImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('이미지 파일(JPG, PNG, WebP, GIF 등)만 첨부할 수 있습니다.'));
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) {
        return reject(new Error('이미지 데이터를 읽을 수 없습니다.'));
      }

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 300;
          canvas.height = img.naturalHeight || img.height || 400;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            // Canvas 컨텍스트 획득 실패 시 원본 DataURL 폴백
            return resolve(result);
          }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          resolve(dataUrl);
        } catch (err) {
          // 보안/CORS 또는 캔버스 에러 시 원본 결과 사용
          resolve(result);
        }
      };

      img.onerror = () => {
        reject(new Error('이미지를 로드하는 중 오류가 발생했습니다.'));
      };

      img.src = result;
    };

    reader.onerror = () => {
      reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
    };

    reader.readAsDataURL(file);
  });
}

export interface PromptValidationResult {
  valid: boolean;
  prompt: string;
  missingFields: string[];
}

// 템플릿 내 플레이스홀더를 프로젝트 메타데이터 및 본문 N자로 치환하며 미입력/부정형식을 차단합니다. (HOW, WHAT)
// USER 요구: slot 플레이스홀더는 무조건 명시적인 글자 수가 지정되어야 하며 퍼센트/누락을 금지합니다. (WHY)
export function validateAndFormatImagePrompt(
  template: string,
  metadata: Partial<ProjectMetadata>,
  novelText: string = ''
): PromptValidationResult {
  if (!template || !template.trim()) {
    return {
      valid: false,
      prompt: '',
      missingFields: ['프롬프트 내용'],
    };
  }

  const missingFields: string[] = [];
  let formatted = template;

  // 1. {{author}}
  if (/\{\{\s*author\s*\}\}/.test(formatted)) {
    const authorVal = (metadata.author || '').trim();
    if (!authorVal) {
      missingFields.push('작가 (author)');
    } else {
      formatted = formatted.replace(/\{\{\s*author\s*\}\}/g, authorVal);
    }
  }

  // 2. {{translated_title}} or {{title}}
  if (/\{\{\s*(translated_title|title)\s*\}\}/.test(formatted)) {
    const titleVal = (metadata.title || '').trim();
    if (!titleVal) {
      missingFields.push('제목 (translated_title)');
    } else {
      formatted = formatted.replace(/\{\{\s*(translated_title|title)\s*\}\}/g, titleVal);
    }
  }

  // 3. {{original_title}}
  if (/\{\{\s*original_title\s*\}\}/.test(formatted)) {
    const origTitleVal = (metadata.originalTitle || '').trim();
    if (!origTitleVal) {
      missingFields.push('원제 (original_title)');
    } else {
      formatted = formatted.replace(/\{\{\s*original_title\s*\}\}/g, origTitleVal);
    }
  }

  // 4. {{description}}
  if (/\{\{\s*description\s*\}\}/.test(formatted)) {
    const descVal = (metadata.description || '').trim();
    if (!descVal) {
      missingFields.push('소개 (description)');
    } else {
      formatted = formatted.replace(/\{\{\s*description\s*\}\}/g, descVal);
    }
  }

  // 5. {{memo}}
  if (/\{\{\s*memo\s*\}\}/.test(formatted)) {
    const memoVal = (metadata.memo || '').trim();
    if (!memoVal) {
      missingFields.push('메모 (memo)');
    } else {
      formatted = formatted.replace(/\{\{\s*memo\s*\}\}/g, memoVal);
    }
  }

  // 6. {{episode_range}}
  if (/\{\{\s*episode_range\s*\}\}/.test(formatted)) {
    const epVal = (metadata.episodeRange || '').trim();
    if (!epVal) {
      missingFields.push('화수 (episode_range)');
    } else {
      formatted = formatted.replace(/\{\{\s*episode_range\s*\}\}/g, epVal);
    }
  }

  // 7. {{slot:N}} - 무조건 양의 정수 글자 수 지정 필수 (퍼센트 및 글자수 누락 금지)
  const anySlotRegex = /\{\{\s*slot(?::[^}]*)?\s*\}\}/g;
  const validSlotRegex = /^\{\{\s*slot:([1-9]\d*)\s*\}\}$/;
  let slotMatch: RegExpExecArray | null;
  while ((slotMatch = anySlotRegex.exec(template)) !== null) {
    const rawTag = slotMatch[0];
    const validMatch = rawTag.match(validSlotRegex);

    if (!validMatch) {
      const errorMsg = '원문 본문 (slot: 양의 정수 글자 수 필수 지정, 예: {{slot:100000}})';
      if (!missingFields.includes(errorMsg)) {
        missingFields.push(errorMsg);
      }
      continue;
    }

    const maxChars = parseInt(validMatch[1], 10);
    const textVal = novelText.trim();
    if (!textVal) {
      if (!missingFields.includes('원문 본문 (slot)')) {
        missingFields.push('원문 본문 (slot)');
      }
    } else {
      const slicedText = textVal.slice(0, maxChars);
      formatted = formatted.replace(rawTag, slicedText);
    }
  }

  if (missingFields.length > 0) {
    return {
      valid: false,
      prompt: '',
      missingFields,
    };
  }

  return {
    valid: true,
    prompt: formatted,
    missingFields: [],
  };
}

// Gemini API 지원 종횡비 목록
export const SUPPORTED_GEMINI_ASPECT_RATIOS = [
  { label: '1:1', ratio: 1.0 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '3:2', ratio: 3 / 2 },
] as const;

// 이미지 Data URL로부터 너비와 높이를 읽어 가장 가까운 Gemini 지원 종횡비를 산출합니다. (HOW, WHAT)
// USER 요구: 표지 수정 시 3:4로 강제하지 않고 원본 이미지의 비율을 동적으로 보존 (WHY)
export async function getClosestSupportedAspectRatio(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl) {
      return resolve('3:4');
    }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        return resolve('3:4');
      }
      const actualRatio = w / h;
      let closest: (typeof SUPPORTED_GEMINI_ASPECT_RATIOS)[number] = SUPPORTED_GEMINI_ASPECT_RATIOS[0];
      let minDiff = Math.abs(actualRatio - closest.ratio);
      for (let i = 1; i < SUPPORTED_GEMINI_ASPECT_RATIOS.length; i++) {
        const diff = Math.abs(actualRatio - SUPPORTED_GEMINI_ASPECT_RATIOS[i].ratio);
        if (diff < minDiff) {
          minDiff = diff;
          closest = SUPPORTED_GEMINI_ASPECT_RATIOS[i];
        }
      }
      resolve(closest.label);
    };
    img.onerror = () => {
      resolve('3:4');
    };
    img.src = dataUrl;
  });
}
