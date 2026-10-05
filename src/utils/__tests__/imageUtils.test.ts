// src/utils/__tests__/imageUtils.test.ts
// 표지 썸네일 이미지 유틸리티 단위 테스트
//
// USER 요구사항: 플레이스홀더 누락 시 차단, slot 글자수 슬라이스, 메타데이터 치환 검증

import { describe, it, expect } from 'vitest';
import { validateAndFormatImagePrompt } from '../imageUtils';
import type { ProjectMetadata } from '../../types/project';

describe('imageUtils', () => {
  describe('validateAndFormatImagePrompt', () => {
    const mockMetadata: Partial<ProjectMetadata> = {
      title: '나 혼자 만렙 귀환',
      originalTitle: '我一个人满级归来',
      author: '김작가',
      episodeRange: '1-10',
      description: '어느 날 최강자가 되어 지구로 돌아왔다.',
      memo: '판타지 웹소설',
    };

    const mockNovelText = '제1장 귀환의 서막\n푸른 빛이 번쩍이며 차원의 문이 열렸다. 100년 만의 지구였다.';

    it('validates and formats a prompt when all placeholders are satisfied', () => {
      const template = `작가: {{author}}
제목: {{translated_title}}
원제: {{original_title}}
소개: {{description}}
내용: {{slot:20}}`;

      const result = validateAndFormatImagePrompt(template, mockMetadata, mockNovelText);

      expect(result.valid).toBe(true);
      expect(result.missingFields).toHaveLength(0);
      expect(result.prompt).toContain('작가: 김작가');
      expect(result.prompt).toContain('제목: 나 혼자 만렙 귀환');
      expect(result.prompt).toContain('원제: 我一个人满级归来');
      expect(result.prompt).toContain('소개: 어느 날 최강자가 되어 지구로 돌아왔다.');
      expect(result.prompt).toContain('내용: 제1장 귀환의 서막\n푸른 빛이');
    });

    it('detects missing author when {{author}} placeholder is used but empty in metadata', () => {
      const template = `작가: {{author}}\n제목: {{translated_title}}`;
      const metadataWithoutAuthor = { ...mockMetadata, author: '' };

      const result = validateAndFormatImagePrompt(template, metadataWithoutAuthor, mockNovelText);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('작가 (author)');
      expect(result.prompt).toBe('');
    });

    it('detects missing title when {{translated_title}} is used but title is empty', () => {
      const template = `제목: {{translated_title}}`;
      const metadataWithoutTitle = { ...mockMetadata, title: '' };

      const result = validateAndFormatImagePrompt(template, metadataWithoutTitle, mockNovelText);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('제목 (translated_title)');
    });

    it('detects missing description when {{description}} is used but description is empty', () => {
      const template = `소개: {{description}}`;
      const metadataWithoutDesc = { ...mockMetadata, description: '' };

      const result = validateAndFormatImagePrompt(template, metadataWithoutDesc, mockNovelText);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('소개 (description)');
    });

    it('detects missing novelText when {{slot:100000}} is used but novelText is empty', () => {
      const template = `본문: {{slot:100000}}`;

      const result = validateAndFormatImagePrompt(template, mockMetadata, '');

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('원문 본문 (slot)');
    });

    it('rejects slot placeholder when character count is omitted ({{slot}})', () => {
      const template = `본문: {{slot}}`;

      const result = validateAndFormatImagePrompt(template, mockMetadata, mockNovelText);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('원문 본문 (slot: 양의 정수 글자 수 필수 지정, 예: {{slot:100000}})');
    });

    it('rejects slot placeholder when percentage is specified ({{slot:50%}})', () => {
      const template = `본문: {{slot:50%}}`;

      const result = validateAndFormatImagePrompt(template, mockMetadata, mockNovelText);

      expect(result.valid).toBe(false);
      expect(result.missingFields).toContain('원문 본문 (slot: 양의 정수 글자 수 필수 지정, 예: {{slot:100000}})');
    });

    it('rejects slot placeholder when non-positive integer is specified ({{slot:0}} or {{slot:abc}})', () => {
      const resultZero = validateAndFormatImagePrompt(`본문: {{slot:0}}`, mockMetadata, mockNovelText);
      expect(resultZero.valid).toBe(false);
      expect(resultZero.missingFields).toContain('원문 본문 (slot: 양의 정수 글자 수 필수 지정, 예: {{slot:100000}})');

      const resultAbc = validateAndFormatImagePrompt(`본문: {{slot:abc}}`, mockMetadata, mockNovelText);
      expect(resultAbc.valid).toBe(false);
      expect(resultAbc.missingFields).toContain('원문 본문 (slot: 양의 정수 글자 수 필수 지정, 예: {{slot:100000}})');
    });

    it('correctly handles default prompts with and without original image', () => {
      const promptWithOriginal = `작가: {{author}}\n제목: {{translated_title}}`;
      const resWith = validateAndFormatImagePrompt(promptWithOriginal, mockMetadata, mockNovelText);
      expect(resWith.valid).toBe(true);
      expect(resWith.prompt).toBe('작가: 김작가\n제목: 나 혼자 만렙 귀환');

      const promptWithoutOriginal = `작가: {{author}}\n제목: {{translated_title}}\n소개: {{description}}\n본문:\n{{slot:100000}}`;
      const resWithout = validateAndFormatImagePrompt(promptWithoutOriginal, mockMetadata, mockNovelText);
      expect(resWithout.valid).toBe(true);
      expect(resWithout.prompt).toContain('작가: 김작가');
      expect(resWithout.prompt).toContain(mockNovelText);
    });
  });

  describe('getClosestSupportedAspectRatio', () => {
    it('returns default 3:4 for empty dataUrl', async () => {
      const { getClosestSupportedAspectRatio } = await import('../imageUtils');
      const ratio = await getClosestSupportedAspectRatio('');
      expect(ratio).toBe('3:4');
    });
  });
});


