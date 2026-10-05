// components/common/CoverImageManager.tsx
// 프로젝트 표지 이미지 관리: 원본 첨부, AI 표지 생성/수정, 프롬프트 템플릿 편집

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Image as ImageIcon,
  Sparkles,
  Upload,
  Trash2,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Loader2,
  Wand2,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useTranslationStore } from '../../stores/translationStore';
import { getGeminiClient } from '../../services/GeminiClient';
import {
  DEFAULT_COVER_IMAGE_PROMPT_WITH_ORIGINAL,
  DEFAULT_COVER_IMAGE_PROMPT_WITHOUT_ORIGINAL,
  type CoverImageThinkingLevel,
} from '../../types/project';
import {
  extractFirstFrameFromImageFile,
  validateAndFormatImagePrompt,
  getClosestSupportedAspectRatio,
} from '../../utils/imageUtils';
import { toast } from '../../stores/toastStore';

const FALLBACK_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

export function CoverImageManager() {
  const project = useProjectStore((state) => state.project);
  const updateProject = useProjectStore((state) => state.updateProject);
  const inputFiles = useTranslationStore((state) => state.inputFiles);
  const results = useTranslationStore((state) => state.results);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [availableImageModels, setAvailableImageModels] = useState<string[]>([]);
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // 사용 가능한 이미지 모델 목록 로드
  useEffect(() => {
    let isMounted = true;
    getGeminiClient()
      .getImageModels()
      .then((models) => {
        if (!isMounted || models.length === 0) return;
        setAvailableImageModels(models);
        const current = useProjectStore.getState().project.coverImageModel;
        if (!current || !models.includes(current)) {
          const preferred = models.find((m) => m.includes('flash-lite-image')) || models[0];
          useProjectStore.getState().updateProject({ coverImageModel: preferred });
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const hasOriginalImage = Boolean(project.originalCoverImage);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      // 움직이는 GIF/WebP도 첫 프레임만 PNG로 저장한다
      const dataUrl = await extractFirstFrameFromImageFile(file);
      updateProject({ originalCoverImage: dataUrl });
      toast.success('원본 표지 이미지를 등록했습니다.', '이미지 첨부');
    } catch (err: any) {
      toast.error(err?.message || '이미지를 불러오지 못했습니다.', '첨부 실패');
    }
  };

  const activePromptTemplate = hasOriginalImage
    ? project.coverImagePromptWithOriginal || DEFAULT_COVER_IMAGE_PROMPT_WITH_ORIGINAL
    : project.coverImagePromptWithoutOriginal || DEFAULT_COVER_IMAGE_PROMPT_WITHOUT_ORIGINAL;

  const handlePromptChange = (value: string) => {
    updateProject(hasOriginalImage ? { coverImagePromptWithOriginal: value } : { coverImagePromptWithoutOriginal: value });
  };

  const handleResetPrompt = () => {
    updateProject(
      hasOriginalImage
        ? { coverImagePromptWithOriginal: DEFAULT_COVER_IMAGE_PROMPT_WITH_ORIGINAL }
        : { coverImagePromptWithoutOriginal: DEFAULT_COVER_IMAGE_PROMPT_WITHOUT_ORIGINAL }
    );
    toast.info('표지 프롬프트를 기본값으로 되돌렸습니다.', '기본값 복원');
  };

  // {{slot:N}}에 넣을 본문: 업로드한 파일이 없으면 청크 원문을 이어 붙인다
  const getFullNovelText = useCallback(() => {
    if (inputFiles.length > 0 && !inputFiles[0].isEpub) {
      return inputFiles.map((f) => f.content || '').join('\n');
    }
    return results.map((r) => r.originalText || '').join('\n');
  }, [inputFiles, results]);

  const handleGenerateCover = async () => {
    const validation = validateAndFormatImagePrompt(activePromptTemplate, project, getFullNovelText());
    if (!validation.valid) {
      toast.error(`다음 항목을 채워야 표지를 만들 수 있습니다: ${validation.missingFields.join(', ')}`, '생성 불가');
      return;
    }

    const model = project.coverImageModel || availableImageModels[0] || FALLBACK_IMAGE_MODEL;
    const thinkingLevel: CoverImageThinkingLevel = project.coverImageThinkingLevel || 'HIGH';
    const actionName = hasOriginalImage ? '수정' : '생성';
    const addLog = useTranslationStore.getState().addLog;

    setIsGenerating(true);
    try {
      // 원본이 있으면 원본 비율에 가장 가까운 지원 비율을 쓴다
      const aspectRatio = hasOriginalImage && project.originalCoverImage
        ? await getClosestSupportedAspectRatio(project.originalCoverImage)
        : '3:4';

      addLog('info', `🎨 표지 ${actionName} 시작 (모델: ${model}, 비율: ${aspectRatio}, 사고: ${thinkingLevel})`);
      const result = await getGeminiClient().generateOrEditCoverImage({
        model,
        prompt: validation.prompt,
        originalImageDataUrl: project.originalCoverImage,
        aspectRatio,
        thinkingLevel,
      });

      updateProject({ modifiedCoverImage: result.imageUrl });
      toast.success(`표지 이미지를 ${actionName}했습니다.`, `표지 ${actionName} 완료`);
    } catch (err: any) {
      toast.error(err?.message || `표지 ${actionName} 중 알 수 없는 오류가 발생했습니다.`, `표지 ${actionName} 실패`, 8000);
    } finally {
      setIsGenerating(false);
    }
  };

  const modelOptions = availableImageModels.length > 0 ? availableImageModels : [FALLBACK_IMAGE_MODEL];

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col space-y-3.5">
      <div className="flex items-center justify-between pb-2.5 border-b border-gray-100">
        <h4 className="text-sm font-bold text-gray-800">표지 이미지</h4>
        <span className="text-xs text-gray-400">
          {hasOriginalImage ? '원본 기반 수정 모드' : '새 표지 생성 모드'}
        </span>
      </div>

      {/* 원본 / 결과 이미지 */}
      <div className="grid grid-cols-2 gap-3">
        {([
          { label: '원본 이미지', image: project.originalCoverImage, onRemove: () => updateProject({ originalCoverImage: undefined }), empty: '첨부하면 수정 모드로 바뀝니다' },
          { label: '수정 / 생성 이미지', image: project.modifiedCoverImage, onRemove: () => updateProject({ modifiedCoverImage: undefined }), empty: '아래 버튼으로 생성' },
        ] as const).map((slot, idx) => (
          <div key={slot.label} className="flex flex-col space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700">{slot.label}</span>
              {slot.image && (
                <button
                  type="button"
                  onClick={slot.onRemove}
                  className="text-red-500 hover:text-red-700 text-xs flex items-center gap-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                  삭제
                </button>
              )}
            </div>
            <div className="relative aspect-[3/4] w-full rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
              {idx === 1 && isGenerating ? (
                <div className="flex flex-col items-center text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-indigo-600 mb-2" />
                  <span className="text-xs font-bold text-indigo-900">AI 표지 처리 중...</span>
                </div>
              ) : slot.image ? (
                <img src={slot.image} alt={slot.label} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center p-2 text-center text-gray-400">
                  {idx === 0 ? <ImageIcon className="w-7 h-7 mb-1" /> : <Sparkles className="w-7 h-7 mb-1" />}
                  <span className="text-[11px]">{slot.empty}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileSelect} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-1.5 px-3 border border-gray-300 hover:border-indigo-400 bg-white text-gray-700 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
      >
        <Upload className="w-3.5 h-3.5" />
        {project.originalCoverImage ? '원본 이미지 변경' : '원본 이미지 첨부 (JPG, PNG, WebP, GIF)'}
      </button>

      {/* 모델 & Thinking Level */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <label className="space-y-1">
          <span className="text-xs font-bold text-gray-700 block">이미지 모델</span>
          <select
            value={project.coverImageModel || modelOptions[0]}
            onChange={(e) => updateProject({ coverImageModel: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-gray-700 block">Thinking Level</span>
          <select
            value={project.coverImageThinkingLevel || 'HIGH'}
            onChange={(e) => updateProject({ coverImageThinkingLevel: e.target.value as CoverImageThinkingLevel })}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
          >
            <option value="HIGH">HIGH (세밀한 추론)</option>
            <option value="MINIMAL">MINIMAL (빠른 응답)</option>
          </select>
        </label>
      </div>

      {/* 프롬프트 템플릿 */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
        <button
          type="button"
          onClick={() => setIsPromptExpanded(!isPromptExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-gray-100"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
            <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
            {hasOriginalImage ? '원본 수정 프롬프트' : '새 표지 생성 프롬프트'}
          </span>
          {isPromptExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </button>
        {isPromptExpanded && (
          <div className="p-3 border-t border-gray-200 bg-white space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500">
                {hasOriginalImage
                  ? '{{author}}, {{translated_title}}을 쓸 수 있습니다.'
                  : '{{author}}, {{translated_title}}, {{description}}, {{slot:N}}(본문 앞 N자)을 쓸 수 있습니다.'}
              </span>
              <button
                type="button"
                onClick={handleResetPrompt}
                className="text-[11px] text-gray-500 hover:text-indigo-600 flex items-center gap-1 shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                기본값 복원
              </button>
            </div>
            <textarea
              value={activePromptTemplate}
              onChange={(e) => handlePromptChange(e.target.value)}
              rows={7}
              className="w-full px-2.5 py-2 text-xs border border-gray-200 rounded-lg font-mono leading-relaxed"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={isGenerating}
        onClick={handleGenerateCover}
        className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 ${
          isGenerating ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
        }`}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            AI 표지 처리 중...
          </>
        ) : hasOriginalImage ? (
          <>
            <Wand2 className="w-4 h-4" />
            표지 수정
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            표지 생성
          </>
        )}
      </button>
    </div>
  );
}
