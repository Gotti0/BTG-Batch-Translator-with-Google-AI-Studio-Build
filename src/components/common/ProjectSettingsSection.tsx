// components/common/ProjectSettingsSection.tsx
// 프로젝트 정보(제목·원제·작가·화수·소개·메모·출력 파일명 패턴)와 표지 이미지 설정

import React, { useMemo, useState } from 'react';
import { FolderArchive, ChevronUp, ChevronDown, CopyPlus } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useTranslationStore } from '../../stores/translationStore';
import { useGlossaryStore } from '../../stores/glossaryStore';
import {
  createDefaultProjectMetadata,
  resolveOutputFileName,
  DEFAULT_PROJECT_OUTPUT_PATTERN,
} from '../../types/project';
import { Input, Textarea } from './FormElements';
import { ConfirmDialog } from './Modal';
import { CoverImageManager } from './CoverImageManager';
import { toast } from '../../stores/toastStore';
import { SnapshotService } from '../../services/SnapshotService';

const PATTERN_PLACEHOLDERS = [
  { tag: '{{translated_title}}', label: '제목' },
  { tag: '{{original_title}}', label: '원제' },
  { tag: '{{author}}', label: '작가' },
  { tag: '{{episode_range}}', label: '화수' },
  { tag: '{{description}}', label: '소개' },
  { tag: '{{memo}}', label: '메모' },
];

export function ProjectSettingsSection() {
  const [isOpen, setIsOpen] = useState(true);
  const [isNewProjectConfirmOpen, setIsNewProjectConfirmOpen] = useState(false);
  const project = useProjectStore((state) => state.project);
  const updateProject = useProjectStore((state) => state.updateProject);
  const inputFiles = useTranslationStore((state) => state.inputFiles);
  const hasResults = useTranslationStore((state) => state.results.length > 0);

  const previewName = useMemo(() => {
    const fallback = inputFiles[0]?.name?.replace(/\.[^/.]+$/, '') || 'translated_output';
    return resolveOutputFileName(project.outputFileNamePattern, project, fallback);
  }, [project, inputFiles]);

  // 번역 설정과 출력 파일명 패턴은 그대로 두고 작업 내용만 비운 새 프로젝트를 시작한다
  const createNewProject = async () => {
    // 지금 상태를 현재 자동 스냅샷에 마저 기록한 뒤, 새 프로젝트는 새 스냅샷에 기록한다
    await SnapshotService.beginNewAutoSession();
    const preservedPattern = useProjectStore.getState().project.outputFileNamePattern;
    useProjectStore.getState().setProject({
      ...createDefaultProjectMetadata(),
      outputFileNamePattern: preservedPattern,
    });
    useTranslationStore.getState().resetWork();
    useGlossaryStore.getState().clearEntries();
    toast.success('번역 설정을 유지한 새 프로젝트를 시작했습니다.', '새 프로젝트');
  };

  const handleNewProjectClick = () => {
    const hasWork = inputFiles.length > 0 || hasResults || project.title !== createDefaultProjectMetadata().title;
    if (hasWork) {
      setIsNewProjectConfirmOpen(true);
    } else {
      createNewProject();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 hover:bg-blue-50 text-left"
      >
        <span className="flex items-center gap-2.5">
          <FolderArchive className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-gray-800 text-lg">프로젝트 설정</span>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-medium">
            {project.title || '새 프로젝트'}
          </span>
        </span>
        {isOpen ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>

      {isOpen && (
        <div className="p-6 border-t border-gray-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5">
            <CoverImageManager />
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Input label="제목" value={project.title} onChange={(e) => updateProject({ title: e.target.value })} />
              <Input label="원제" value={project.originalTitle} onChange={(e) => updateProject({ originalTitle: e.target.value })} />
              <Input label="작가" value={project.author} onChange={(e) => updateProject({ author: e.target.value })} />
              <Input
                label="화수 / 범위"
                value={project.episodeRange}
                onChange={(e) => updateProject({ episodeRange: e.target.value })}
                placeholder="예: 1-5"
              />
            </div>

            <Textarea
              label="소개"
              value={project.description}
              onChange={(e) => updateProject({ description: e.target.value })}
              rows={3}
              placeholder="EPUB 내보내기 시 '작품 소개' 페이지로 들어갑니다."
            />
            <Textarea
              label="메모"
              value={project.memo}
              onChange={(e) => updateProject({ memo: e.target.value })}
              rows={2}
            />

            <div className="space-y-1.5 pt-2 border-t border-gray-100">
              <Input
                label="출력 파일명 패턴"
                value={project.outputFileNamePattern}
                onChange={(e) => updateProject({ outputFileNamePattern: e.target.value })}
                placeholder={DEFAULT_PROJECT_OUTPUT_PATTERN}
                className="font-mono text-sm"
                helperText="번역 결과·EPUB·스냅샷을 내려받을 때 파일명으로 쓰입니다."
              />
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {PATTERN_PLACEHOLDERS.map(({ tag, label }) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => updateProject({ outputFileNamePattern: (project.outputFileNamePattern || '') + tag })}
                    className="px-2 py-0.5 bg-gray-100 hover:bg-blue-100 hover:text-blue-700 text-gray-600 rounded border border-gray-200 font-mono"
                    title="패턴 끝에 추가"
                  >
                    +{tag} <span className="font-sans text-gray-400">({label})</span>
                  </button>
                ))}
              </div>
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs font-mono text-blue-900">
                미리보기: <span className="font-bold">{previewName}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <span className="text-xs text-gray-500">
                프롬프트·모델 등 번역 설정과 출력 파일명 패턴은 유지하고, 파일·번역 결과·용어집·프로젝트 정보를 비웁니다.
              </span>
              <button
                type="button"
                onClick={handleNewProjectClick}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg shrink-0"
              >
                <CopyPlus className="w-3.5 h-3.5" />
                새 프로젝트 시작
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={isNewProjectConfirmOpen}
        onClose={() => setIsNewProjectConfirmOpen(false)}
        onConfirm={() => {
          setIsNewProjectConfirmOpen(false);
          createNewProject();
        }}
        title="새 프로젝트 시작"
        message={'업로드한 파일, 번역 결과, 용어집, 프로젝트 정보가 비워집니다.\n현재 상태는 자동 스냅샷에 남아 있어 스냅샷 탭에서 되돌릴 수 있습니다.\n\n새 프로젝트를 시작할까요?'}
        confirmText="새 프로젝트 시작"
        cancelText="취소"
      />
    </div>
  );
}
