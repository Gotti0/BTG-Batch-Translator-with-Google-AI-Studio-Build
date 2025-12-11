// pages/TranslationPage.tsx
// 설정 및 번역 페이지

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Play, Square, Save, Upload, Settings, Zap, Download, RefreshCw, RotateCcw, FileJson, BookOpen, CheckCircle } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useTranslationStore } from '../stores/translationStore';
import { useTranslation } from '../hooks/useTranslation';
import { FileHandler } from '../utils/fileHandler';
import { getGeminiClient } from '../services/GeminiClient';
import { TranslationService } from '../services/TranslationService';
import { DEFAULT_PREFILL_SYSTEM_INSTRUCTION, DEFAULT_PREFILL_CACHED_HISTORY, DEFAULT_PROMPTS } from '../types/config';
import { EpubService } from '../services/EpubService';
import JSZip from 'jszip';
import { 
  Button, 
  Select, 
  Input, 
  Slider, 
  Checkbox, 
  Textarea,
  FileUpload,
  ProgressBar,
  SegmentedProgressBar,
} from '../components';
import type { FileContent } from '../types/dtos';

/**
 * 파일 업로드 영역 컴포넌트
 */
function FileUploadSection({ onImportSnapshot, mode, onEpubChaptersChange, onModeChange, epubChapters }: { onImportSnapshot: (file: File) => Promise<string | void>; mode: 'text' | 'epub'; onEpubChaptersChange: (chapters: any[]) => void; onModeChange: (mode: 'text' | 'epub') => void; epubChapters: any[] }) {
  const { inputFiles, addInputFiles, removeInputFile, clearInputFiles, addLog } = useTranslationStore();
  
  // File 객체를 FileContent로 변환하여 스토어에 추가 또는 스냅샷 복구
  const handleFilesSelected = useCallback(async (files: File[]) => {
    const textFiles: any[] = [];
    let snapshotFound = false;
    
    for (const file of files) {
      // JSON 파일(스냅샷) 감지
      if (file.name.endsWith('.json')) {
        addLog('info', `스냅샷 파일 감지: ${file.name}`);
        const restoredMode = await onImportSnapshot(file);
        // Phase 5: 스냅샷의 모드가 반환되면 자동으로 모드 전환
        if (restoredMode) {
          onModeChange(restoredMode as 'text' | 'epub');
          addLog('info', `📋 모드 자동 변경: ${restoredMode}`);
        }
        snapshotFound = true;
        return; 
      }

      // EPUB 파일 처리
      if (mode === 'epub' && file.name.endsWith('.epub')) {
        try {
          addLog('info', `EPUB 파일 로드 중: ${file.name}`);
          const epubService = new EpubService();
          const chapters = await epubService.parseEpubFile(file);
          
          onEpubChaptersChange(chapters);
          addLog('info', `✅ EPUB 파싱 완료: ${chapters.length}개 챕터`);
          
          // inputFiles에 원본 파일 정보 저장
          textFiles.push({
            name: file.name,
            content: `[EPUB File] ${chapters.length} chapters loaded`,
            size: file.size,
            lastModified: file.lastModified,
            epubFile: file,
            epubChapters: chapters,
            isEpub: true,
          });
        } catch (error) {
          addLog('error', `EPUB 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (mode === 'text') {
        try {
          const content = await file.text();
          textFiles.push({
            name: file.name,
            content,
            size: file.size,
            lastModified: file.lastModified,
          });
        } catch (error) {
          console.error(`파일 읽기 실패: ${file.name}`, error);
        }
      }
    }
    
    if (textFiles.length > 0 && !snapshotFound) {
      addInputFiles(textFiles);
    }
  }, [addInputFiles, addLog, mode, onImportSnapshot, onEpubChaptersChange, onModeChange]);

  const handleFileRemove = useCallback((index: number) => {
    removeInputFile(index);
    onEpubChaptersChange([]);
  }, [removeInputFile, onEpubChaptersChange]);

  const handleClearAll = useCallback(() => {
    clearInputFiles();
    onEpubChaptersChange([]);
  }, [clearInputFiles, onEpubChaptersChange]);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <Upload className="w-5 h-5" />
        파일 설정
      </h2>
      
      <FileUpload
        accept={mode === 'epub' ? ['.epub'] : ['.txt', '.json']}
        multiple={mode === 'text'}
        maxSize={mode === 'epub' ? 100 * 1024 * 1024 : 50 * 1024 * 1024}
        onFilesSelected={handleFilesSelected}
        selectedFiles={inputFiles}
        onFileRemove={handleFileRemove}
        height="h-32"
      />
      <p className="text-xs text-gray-500 mt-2 ml-1">
        {mode === 'epub' 
          ? '* EPUB 파일(.epub)을 업로드하여 번역할 수 있습니다.'
          : '* 텍스트 파일(.txt)을 업로드하여 새 작업을 시작하거나, 작업 파일(.json)을 업로드하여 이어서 진행할 수 있습니다.'}
      </p>

      {/* EPUB 챕터 정보 */}
      {epubChapters.length > 0 && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm font-semibold text-blue-900 mb-2">
            📚 로드된 EPUB: {epubChapters.length}개 챕터
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {epubChapters.map((ch, idx) => (
              <div key={idx} className="text-xs bg-white p-2 rounded border border-blue-100">
                <div className="font-semibold text-blue-700">Chapter {idx + 1}</div>
                <div className="text-gray-600 truncate">{ch.fileName}</div>
                <div className="text-gray-500">{ch.nodes.length} nodes</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 전체 삭제 버튼 */}
      {inputFiles.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="danger"
            size="sm"
            onClick={handleClearAll}
          >
            전체 삭제
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * 프리필 설정 에디터 컴포넌트
 */
function PrefillSettingsEditor() {
  const { config, updateConfig } = useSettingsStore();

  // 히스토리 파싱 헬퍼
  const getHistoryPart = (role: 'user' | 'model'): string => {
    const item = config.prefillCachedHistory.find(h => h.role === role);
    return item?.parts[0] || '';
  };

  // 히스토리 업데이트 헬퍼
  const updateHistory = (role: 'user' | 'model', text: string) => {
    const currentHistory = [...config.prefillCachedHistory];
    
    // 기존 구조 유지하면서 내용만 업데이트 (없으면 생성)
    const userIndex = currentHistory.findIndex(h => h.role === 'user');
    const modelIndex = currentHistory.findIndex(h => h.role === 'model');

    const newUserPart = role === 'user' ? text : (userIndex >= 0 ? currentHistory[userIndex].parts[0] : '');
    const newModelPart = role === 'model' ? text : (modelIndex >= 0 ? currentHistory[modelIndex].parts[0] : '');

    const newHistory = [
      { role: 'user' as const, parts: [newUserPart] },
      { role: 'model' as const, parts: [newModelPart] }
    ];

    updateConfig({ prefillCachedHistory: newHistory });
  };

  const handleResetDefaults = () => {
    if (confirm('프리필 설정을 기본값으로 초기화하시겠습니까?')) {
      updateConfig({
        prefillSystemInstruction: DEFAULT_PREFILL_SYSTEM_INSTRUCTION,
        prefillCachedHistory: DEFAULT_PREFILL_CACHED_HISTORY,
      });
    }
  };

  return (
    <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg space-y-4 animate-fadeIn">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          상세 프리필 설정 (Advanced Prefill)
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleResetDefaults}
          className="text-blue-600 hover:text-blue-800 hover:bg-blue-100 h-8 text-xs"
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          기본값 복원
        </Button>
      </div>
      
      <Textarea
        label="시스템 지침 (System Instruction)"
        value={config.prefillSystemInstruction}
        onChange={(e) => updateConfig({ prefillSystemInstruction: e.target.value })}
        rows={6}
        className="font-mono text-xs"
        helperText="모델의 역할과 기본적인 번역 규칙을 정의합니다."
      />

      <div className="grid grid-cols-1 gap-4">
        <Textarea
          label="히스토리: 사용자 요청 (User Prompt)"
          value={getHistoryPart('user')}
          onChange={(e) => updateHistory('user', e.target.value)}
          rows={4}
          className="font-mono text-xs"
          helperText="번역 톤앤매너, 주의사항 등을 구체적으로 지시하는 페르소나 설정입니다."
        />

        <Textarea
          label="히스토리: 모델 응답 (Model Acknowledgement)"
          value={getHistoryPart('model')}
          onChange={(e) => updateHistory('model', e.target.value)}
          rows={3}
          className="font-mono text-xs"
          helperText="모델이 지시사항을 이해했음을 확인하는 가상의 응답입니다."
        />
      </div>
      
      <div className="text-xs text-blue-600 bg-blue-100 p-2 rounded">
        💡 <strong>Tip:</strong> 이 설정은 번역 요청 이전에 모델에게 '이전 대화'로 주입되어, 모델이 설정된 페르소나를 유지하도록 돕습니다.
      </div>
    </div>
  );
}

/**
 * 번역 설정 컴포넌트
 */
function TranslationSettings() {
  const { config, updateConfig } = useSettingsStore();
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // 모델 목록 로드
  useEffect(() => {
    const fetchModels = async () => {
      setIsLoadingModels(true);
      try {
        const client = getGeminiClient();
        
        const models = await client.getAvailableModels();
        
        const options = models.map(model => ({
          value: model,
          label: model
        }));

        // 현재 설정된 모델이 목록에 없으면 추가 (선택 유지)
        if (config.modelName && !models.includes(config.modelName)) {
          options.unshift({ value: config.modelName, label: config.modelName });
        }

        setModelOptions(options);
      } catch (error) {
        console.error('모델 목록 불러오기 실패:', error);
        // 실패 시 기본 목록 제공
        setModelOptions([
          { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
          { value: 'gemini-2.0-flash-lite-preview-02-05', label: 'Gemini 2.0 Flash Lite' },
          { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
          { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
        ]);
      } finally {
        setIsLoadingModels(false);
      }
    };

    fetchModels();
  }, [config.modelName]);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5" />
        번역 설정
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 모델 선택 */}
        <Select
          label={isLoadingModels ? "모델 (목록 로딩 중...)" : "모델"}
          value={config.modelName}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateConfig({ modelName: e.target.value })}
          options={modelOptions}
          disabled={isLoadingModels}
        />

        {/* 청크 크기 */}
        <Input
          type="number"
          label="청크 크기 (글자)"
          value={config.chunkSize}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ chunkSize: parseInt(e.target.value) || 6000 })}
          min={1000}
          max={50000}
        />

        {/* Temperature */}
        <Slider
          label="Temperature"
          value={config.temperature}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ temperature: parseFloat(e.target.value) })}
          min={0}
          max={2}
          step={0.1}
          formatValue={(v: number) => v.toFixed(1)}
        />

        {/* RPM */}
        <Input
          type="number"
          label="분당 요청 수 (RPM)"
          value={config.requestsPerMinute}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ requestsPerMinute: parseFloat(e.target.value) || 10 })}
          min={1}
          max={100}
        />

        {/* Max Workers */}
        <Input
          type="number"
          label="동시 작업 수 (Max Workers)"
          value={config.maxWorkers || 1}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ maxWorkers: Math.max(1, parseInt(e.target.value) || 1) })}
          min={1}
          max={20}
          helperText="병렬로 처리할 청크 수입니다. 속도는 빨라지지만 브라우저 부하가 늘어날 수 있습니다."
        />

        {/* 프리필 모드 */}
        <div className="md:col-span-2">
          <Checkbox
            label="프리필 번역 모드 사용 (Prefill Translation)"
            checked={config.enablePrefillTranslation}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ enablePrefillTranslation: e.target.checked })}
            description="더 자연스러운 번역을 위해 사전 학습된 컨텍스트(페르소나)를 사용합니다."
          />
          
          {/* 프리필 상세 설정 에디터 */}
          {config.enablePrefillTranslation && <PrefillSettingsEditor />}
        </div>

        {/* 용어집 주입 */}
        <div className="md:col-span-2">
          <Checkbox
            label="동적 용어집 주입 (Dynamic Glossary Injection)"
            checked={config.enableDynamicGlossaryInjection}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ enableDynamicGlossaryInjection: e.target.checked })}
            description="번역 시 용어집 항목을 프롬프트에 자동으로 포함합니다."
          />
          
          {/* 용어집 주입 상세 설정 */}
          {config.enableDynamicGlossaryInjection && (
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4 animate-fadeIn">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-4 h-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-700">용어집 주입 상세 설정</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  type="number"
                  label="청크당 최대 주입 항목 수"
                  value={config.maxGlossaryEntriesPerChunkInjection}
                  onChange={(e) => updateConfig({ maxGlossaryEntriesPerChunkInjection: parseInt(e.target.value) || 0 })}
                  min={0}
                  helperText="한 번의 번역 요청에 포함할 최대 용어 수입니다."
                />
                <Input
                  type="number"
                  label="청크당 최대 주입 글자 수"
                  value={config.maxGlossaryCharsPerChunkInjection}
                  onChange={(e) => updateConfig({ maxGlossaryCharsPerChunkInjection: parseInt(e.target.value) || 0 })}
                  min={0}
                  helperText="용어집 컨텍스트가 차지할 수 있는 최대 글자 수입니다."
                />
              </div>
              <div className="text-xs text-gray-500">
                * 프롬프트 길이 제한을 초과하지 않도록 적절한 값을 설정하세요. 설정된 제한을 넘는 경우 등장 빈도가 높은 순으로 잘립니다.
              </div>
            </div>
          )}
        </div>

        {/* 이미지 주석 생성 */}
        <div className="md:col-span-2">
          <Checkbox
            label="EPUB 이미지 AI 주석 생성 (Image Annotation)"
            checked={config.enableImageAnnotation}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ enableImageAnnotation: e.target.checked })}
            description="EPUB 내의 이미지를 분석하여 AI가 설명을 생성하고 텍스트로 추가합니다. (Gemini Vision 모델 필요)"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 프롬프트 설정 컴포넌트
 */
function PromptSettings() {
  const { config, updateConfig } = useSettingsStore();
  const [isExpanded, setIsExpanded] = useState(false);

  // [추가] 초기화 핸들러 구현
  const handleResetDefaults = useCallback(() => {
    if (confirm('번역 프롬프트를 기본값으로 초기화하시겠습니까?\n현재 작성된 내용은 사라집니다.')) {
      updateConfig({ prompts: DEFAULT_PROMPTS });
    }
  }, [updateConfig]);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex justify-between items-center text-xl font-semibold text-gray-800"
        >
          <span>📝 번역 프롬프트 템플릿</span>
          <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
        </button>

        {/* [추가] 초기화 버튼 (확장되었을 때만 보여도 되고, 항상 보여도 됨 - 여기선 항상 노출) */}
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation(); // 아코디언 토글 방지
            handleResetDefaults();
          }}
          className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 text-xs flex-shrink-0"
          title="기본값으로 복원"
        >
          <RotateCcw className="w-4 h-4 mr-1" />
          기본값 복원
        </Button>
        </div>
      
      {isExpanded && (
        <div className="mt-4">
          <Textarea
            label="메인 번역 프롬프트"
            value={config.prompts}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateConfig({ prompts: e.target.value })}
            rows={10}
            helperText="사용 가능한 플레이스홀더: {{slot}} (원문), {{glossary_context}} (용어집)"
            className="font-mono text-sm"
          />
        </div>
      )}
    </div>
  );
}

/**
 * 시간 포맷팅 유틸리티
 */
const formatTime = (seconds?: number) => {
  if (seconds === undefined || seconds < 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}분 ${secs.toString().padStart(2, '0')}초`;
};

/**
 * 진행률 표시 컴포넌트
 */
function ProgressSection() {
  const { isRunning, progress } = useTranslationStore();

  if (!isRunning && !progress) return null;

  const percentage = progress?.totalChunks
    ? Math.round((progress.processedChunks / progress.totalChunks) * 100)
    : 0;

  return (
    <div className="bg-white rounded-lg shadow p-6">
       <div className="flex justify-between items-end mb-2">
        <span className="text-sm font-medium text-gray-700">
           {progress?.currentStatusMessage || '준비 중...'}
        </span>
        
        {/* ETA 표시 */}
        {isRunning && progress?.etaSeconds !== undefined && (
          <span className="text-sm font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded">
            남은 시간: {formatTime(progress.etaSeconds)}
          </span>
        )}
      </div>

      <ProgressBar
        value={percentage}
        // label은 위에서 커스텀하게 표시함
        showPercentage
        detail={progress ? `${progress.processedChunks}/${progress.totalChunks}` : undefined}
        color="primary"
        height="lg"
        striped={isRunning}
        animated={isRunning}
      />
      
      {/* 상세 통계 */}
      {progress && (
        <div className="mt-4">
          <SegmentedProgressBar
            segments={[
              { value: progress.successfulChunks, color: 'success', label: '성공' },
              { value: progress.failedChunks, color: 'danger', label: '실패' },
              { value: progress.totalChunks - progress.processedChunks, color: 'gray', label: '대기' },
            ]}
            total={progress.totalChunks}
            showLegend
            height="sm"
          />
        </div>
      )}
      
      {/* 오류 메시지 */}
      {progress?.lastErrorMessage && (
        <div className="bg-red-50 text-red-700 p-3 rounded mt-3 text-sm">
          마지막 오류: {progress.lastErrorMessage}
        </div>
      )}
    </div>
  );
}

const PREVIEW_MAX_LENGTH = 3000;

/**
 * 번역 결과 미리보기 컴포넌트
 * 대용량 텍스트 렌더링 시 브라우저 프리징 방지를 위해 일부만 보여줍니다.
 */
function ResultPreview({ mode }: { mode: 'text' | 'epub' }) {
  const { translatedText, results } = useTranslationStore();

  // [FIX] useMemo를 조건부 반환문(early return) 이전에 호출하여 Hook 규칙 준수
  // 텍스트 미리보기 계산 (메모이제이션)
  const previewText = useMemo(() => {
    if (translatedText.length <= PREVIEW_MAX_LENGTH) {
      return translatedText;
    }
    return translatedText.slice(0, PREVIEW_MAX_LENGTH) + 
      `\n\n... (전체 내용은 ${translatedText.length.toLocaleString()}자입니다. 아래 '결과 다운로드' 버튼을 이용하세요)`;
  }, [translatedText]);

  if (!translatedText && results.length === 0) return null;
  if (mode === 'epub') return null;

  const successCount = results.filter((r: { success: boolean }) => r.success).length;
  const failCount = results.filter((r: { success: boolean }) => !r.success).length;

  return (
    <>
      {/* 결과 통계 */}
      {results.length > 0 && (
        <div className="flex gap-4 mb-3 text-sm">
          <span className="text-gray-600">
            총 {results.length}개 청크
          </span>
          <span className="text-green-600">
            ✓ 성공: {successCount}
          </span>
          {failCount > 0 && (
            <span className="text-red-600">
              ✗ 실패: {failCount}
            </span>
          )}
        </div>
      )}
      
      <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
        <pre className="whitespace-pre-wrap text-sm text-gray-700">
          {previewText || '번역 결과가 여기에 표시됩니다...'}
        </pre>
      </div>
      
      <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
        <span>총 {translatedText.length.toLocaleString()}자</span>
        {translatedText.length > PREVIEW_MAX_LENGTH && (
          <span className="text-orange-600 bg-orange-50 px-2 py-1 rounded text-xs">
            ⚠️ 성능을 위해 일부만 미리보기로 표시됩니다.
          </span>
        )}
      </div>
    </>
  );
}

/**
 * 설정 및 번역 페이지 메인 컴포넌트
 */
export function TranslationPage() {
  const { config, exportConfig } = useSettingsStore();
  const { addLog, results, translatedText, addResult } = useTranslationStore();
  const [mode, setMode] = useState<'text' | 'epub'>('text');
  const [epubChapters, setEpubChapters] = useState<any[]>([]);
  
  // [추가] 번역된 EPUB 다운로드 URL 및 파일명 관리
  const [epubDownloadUrl, setEpubDownloadUrl] = useState<string | null>(null);
  const [epubDownloadName, setEpubDownloadName] = useState<string>('');
  const [isEpubTranslating, setIsEpubTranslating] = useState(false);
  
  // [추가] EPUB 번역 서비스 인스턴스 참조 (중단 기능을 위해 필요)
  const epubServiceRef = React.useRef<TranslationService | null>(null);

  const {
    inputFiles,
    isRunning,
    hasFailedChunks,
    canStart,
    canStop,
    executeTranslation,
    cancelTranslation,
    retryFailedChunks,
    exportSnapshot,
    importSnapshot,
    downloadResult,
  } = useTranslation();

  const handleStartTranslation = useCallback(async () => {
    // [개선 1] 시작 시 이전 완료 상태 초기화
    setEpubDownloadUrl(null);
    setEpubDownloadName('');

    if (mode === 'epub') {
      setIsEpubTranslating(true);
      const epubFile: any = inputFiles[0];
      if (epubFile && epubFile.isEpub && epubFile.epubFile) {
        // [개선 2] 명확한 시작 로그
        addLog('info', `🚀 [단계 1/4] EPUB 번역 작업을 시작합니다: ${epubFile.name}`);
        
        try {
          const translationService = new TranslationService(config);
          // [추가] 서비스 인스턴스 저장 (중단용)
          epubServiceRef.current = translationService;
          
          // 이미지 주석 처리 준비
          let zip: JSZip | undefined;
          if (config.enableImageAnnotation) {
            addLog('info', '🖼️ 이미지 주석 생성을 위해 EPUB 이미지를 로드합니다.');
            try {
              zip = await JSZip.loadAsync(epubFile.epubFile);
            } catch (e) {
              addLog('warning', '이미지 로드 실패. 주석 생성 없이 진행합니다.');
            }
          }

          addLog('info', `📖 [단계 2/4] 텍스트 번역을 시작합니다. (청크 크기: ${config.chunkSize})`);

          const translatedNodes = await translationService.translateEpubNodes(
            epubFile.epubChapters.flatMap((ch: any) => ch.nodes),
            [], // 용어집이 있다면 여기에 전달
            (progress: any) => {
              // 진행률 로그는 너무 빈번할 수 있으므로 필요 시 주석 처리하거나 빈도 조절
              // addLog('debug', `진행률: ${progress.processedChunks}/${progress.totalChunks}`);
            },
            (result) => {
              addResult(result);
            },
            zip,
            results // [추가] 기존 결과 전달 (스킵 로직용)
          );

          addLog('info', '📚 [단계 3/4] 번역된 데이터를 EPUB 포맷으로 재조립합니다.');

          // [디버깅] 번역 결과 샘플 확인
          const sampleNode = translatedNodes.find(n => n.type === 'text' && n.content?.trim().length > 0);
          if (sampleNode) {
             addLog('info', `🔍 번역 데이터 검증 (샘플): ID=${sampleNode.id}, 내용=${sampleNode.content?.substring(0, 30)}...`);
          } else {
             addLog('warning', '⚠️ 번역된 텍스트 노드를 찾을 수 없습니다!');
          }

          // EPUB 재조립
          const epubService = new EpubService();
          
          // [수정] 단순 슬라이싱 대신 ID 기반으로 노드를 챕터에 분배
          // (이미지 주석 생성 등으로 노드 수가 변경되었을 때 밀림 현상 방지)
          const translatedChapters = epubFile.epubChapters.map((chapter: any) => ({
            ...chapter,
            nodes: [] as any[]
          }));

          let currentChapterIndex = 0;
          
          for (const node of translatedNodes) {
            // 현재 챕터 가져오기
            let currentChapter = translatedChapters[currentChapterIndex];
            
            // 노드 ID가 현재 챕터 파일명으로 시작하는지 확인
            // (ID 형식: {fileName}_{index} 또는 {fileName}_title)
            const expectedPrefix = `${currentChapter.fileName}_`;
            
            if (!node.id.startsWith(expectedPrefix)) {
              // 현재 챕터와 매칭되지 않으면, 다음 챕터들 중에서 매칭되는 챕터 찾기
              let foundNext = false;
              for (let i = currentChapterIndex + 1; i < translatedChapters.length; i++) {
                if (node.id.startsWith(`${translatedChapters[i].fileName}_`)) {
                  currentChapterIndex = i;
                  currentChapter = translatedChapters[i];
                  foundNext = true;
                  break;
                }
              }
              
              if (!foundNext) {
                // 매칭되는 챕터를 찾지 못한 경우 (예외 상황)
                // 로그를 남기고 현재 챕터에 포함시키거나, 이전 챕터의 잔여물로 간주
                // 여기서는 안전하게 현재 챕터에 포함시킴
                // console.warn(`Node ID mismatch: ${node.id} (Current: ${currentChapter.fileName})`);
              }
            }
            
            translatedChapters[currentChapterIndex].nodes.push(node);
          }

          const epubBlob = await epubService.generateEpubBlob(epubFile.epubFile, translatedChapters);
          
          // [개선 3] 자동 다운로드 대신 URL 생성 및 상태 저장
          const url = URL.createObjectURL(epubBlob);
          const downloadName = `${epubFile.name.replace('.epub', '')}_translated.epub`;
          
          setEpubDownloadUrl(url);
          setEpubDownloadName(downloadName);

          addLog('info', `✅ [단계 4/4] 모든 작업이 완료되었습니다! 아래 '결과 다운로드' 버튼을 눌러 파일을 저장하세요.`);

        } catch (error) {
          addLog('error', `❌ 작업 실패: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          setIsEpubTranslating(false);
        }
      } else {
        setIsEpubTranslating(false);
      }
    } else {
      executeTranslation();
    }
  }, [mode, inputFiles, executeTranslation, addLog, config]);

  const handleStopTranslation = useCallback(() => {
    if (mode === 'epub') {
      // EPUB 모드 중단 처리
      if (epubServiceRef.current) {
        epubServiceRef.current.requestStop();
        addLog('warning', 'EPUB 번역이 사용자에 의해 중단되었습니다.');
      }
      setIsEpubTranslating(false);
    } else {
      // 텍스트 모드 중단 처리
      cancelTranslation();
    }
  }, [mode, cancelTranslation, addLog]);

  const handleRetryFailed = useCallback(() => {
    retryFailedChunks();
  }, [retryFailedChunks]);

  const handleExportSettings = useCallback(() => {
    exportConfig();
    addLog('info', '설정이 저장되었습니다.');
  }, [exportConfig, addLog]);

  return (
    <div className="space-y-6 fade-in">
      {/* 모드 선택 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5" />
          번역 모드 선택
        </h2>
        
        <div className="flex gap-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="text"
              checked={mode === 'text'}
              onChange={(e) => setMode(e.target.value as 'text' | 'epub')}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="flex items-center gap-2 text-gray-700 font-medium">
              📝 텍스트 번역
            </span>
            <span className="text-xs text-gray-500">(일반 텍스트 파일)</span>
          </label>
          
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="epub"
              checked={mode === 'epub'}
              onChange={(e) => setMode(e.target.value as 'text' | 'epub')}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="flex items-center gap-2 text-gray-700 font-medium">
              <BookOpen className="w-4 h-4" />
              EPUB 번역
            </span>
            <span className="text-xs text-gray-500">(전자책 파일)</span>
          </label>
        </div>
        
        {mode === 'epub' && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            💡 <strong>EPUB 모드</strong>에서는 전자책 파일을 업로드하면 자동으로 파싱되고, 번역 후 새로운 EPUB 파일로 다운로드됩니다.
          </div>
        )}
      </div>
      
      {/* 파일 업로드 (모드에 따라 다른 UI) */}
      <FileUploadSection onImportSnapshot={importSnapshot} mode={mode} onEpubChaptersChange={setEpubChapters} onModeChange={setMode} epubChapters={epubChapters} />
      
      {/* 번역 설정 */}
      <TranslationSettings />
      
      {/* 프롬프트 설정 */}
      <PromptSettings />
      
      {/* 진행률 */}
      <ProgressSection />
      
      {/* [개선 4] 결과 미리보기 및 다운로드 영역 개선 */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            {mode === 'epub' ? '📚 EPUB 작업 결과' : '📄 번역 결과'}
          </h2>
          <div className="flex gap-2">
            {mode !== 'epub' && results.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<FileJson className="w-4 h-4" />}
                onClick={() => exportSnapshot(mode, undefined)}
                title="현재 진행 상황을 파일로 저장하여 나중에 이어할 수 있습니다."
              >
                작업 저장
              </Button>
            )}
            {mode === 'epub' && results.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<FileJson className="w-4 h-4" />}
                onClick={() => exportSnapshot(mode, epubChapters)}
                title="EPUB 번역 진행 상황을 파일로 저장하여 나중에 이어할 수 있습니다."
              >
                작업 저장
              </Button>
            )}
            {mode !== 'epub' && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Download className="w-4 h-4" />}
                onClick={() => downloadResult()}
                disabled={!translatedText}
              >
                결과 다운로드
              </Button>
            )}
          </div>
        </div>

        {mode === 'epub' ? (
          <div className="text-center py-8">
            {epubDownloadUrl ? (
              <div className="space-y-4 animate-fadeIn">
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-medium text-gray-900">번역이 완료되었습니다!</h3>
                <p className="text-gray-500">파일이 준비되었습니다. 아래 버튼을 눌러 저장하세요.</p>
                
                <a 
                  href={epubDownloadUrl} 
                  download={epubDownloadName}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium shadow-sm"
                >
                  <Download className="w-5 h-5" />
                  {epubDownloadName} 다운로드
                </a>
              </div>
            ) : (
              <p className="text-gray-500">
                {isRunning || isEpubTranslating ? 'EPUB 번역이 진행 중입니다... 로그 탭을 확인하세요.' : '번역을 시작하면 결과가 여기에 표시됩니다.'}
              </p>
            )}&& !isEpubTranslating 
          </div>
        ) : (
          /* 기존 텍스트 모드 미리보기 (ResultPreview 컴포넌트 내용) */
          <ResultPreview mode={mode} />
        )}
      </div>
      
      {/* 액션 버튼 */}
      <div className="flex gap-4">
        {!isRunning ? (
          <>
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={!canStart || isEpubTranslating}
              loading={isEpubTranslating}
              leftIcon={<Play className="w-5 h-5" />}
              onClick={handleStartTranslation}
            >
              {mode === 'epub' ? 'EPUB 번역 시작' : '번역 시작 (또는 이어하기)'}
            </Button>
            
            {hasFailedChunks && (
              <Button
                variant="secondary"
                size="lg"
                leftIcon={<RefreshCw className="w-5 h-5" />}
                onClick={handleRetryFailed}
              >
                실패 재시도
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            leftIcon={<Square className="w-5 h-5" />}
            onClick={handleStopTranslation}
          >
            번역 중지
          </Button>
        )}
        
        <Button
          variant="outline"
          size="lg"
          leftIcon={<Save className="w-5 h-5" />}
          onClick={handleExportSettings}
          className="whitespace-nowrap shrink-0"
        >
          설정 저장
        </Button>
      </div>
    </div>
  );
}
