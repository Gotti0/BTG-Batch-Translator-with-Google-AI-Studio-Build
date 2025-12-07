// pages/TranslationPage.tsx
// 설정 및 번역 페이지

import React, { useState, useCallback } from 'react';
import { Play, Square, Save, Upload, Settings, Zap, Download, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore';
import { useTranslationStore } from '../stores/translationStore';
import { useTranslation } from '../hooks/useTranslation';
import { FileHandler } from '../utils/fileHandler';
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
function FileUploadSection() {
  const { inputFiles, addInputFiles, removeInputFile, clearInputFiles } = useTranslationStore();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // File 객체를 FileContent로 변환하여 스토어에 추가
  const handleFilesSelected = useCallback(async (files: File[]) => {
    const fileContents: FileContent[] = [];
    
    for (const file of files) {
      try {
        const content = await file.text();
        fileContents.push({
          name: file.name,
          content,
          size: file.size,
          lastModified: file.lastModified,
        });
      } catch (error) {
        console.error(`파일 읽기 실패: ${file.name}`, error);
      }
    }
    
    if (fileContents.length > 0) {
      addInputFiles(fileContents);
      setSelectedFiles((prev: File[]) => [...prev, ...files]);
    }
  }, [addInputFiles]);

  const handleFileRemove = useCallback((index: number) => {
    removeInputFile(index);
    setSelectedFiles((prev: File[]) => prev.filter((_: File, i: number) => i !== index));
  }, [removeInputFile]);

  const handleClearAll = useCallback(() => {
    clearInputFiles();
    setSelectedFiles([]);
  }, [clearInputFiles]);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <Upload className="w-5 h-5" />
        파일 설정
      </h2>
      
      <FileUpload
        accept={['.txt']}
        multiple={true}
        maxSize={50 * 1024 * 1024}
        onFilesSelected={handleFilesSelected}
        selectedFiles={selectedFiles}
        onFileRemove={handleFileRemove}
        height="h-32"
      />

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
 * 번역 설정 컴포넌트
 */
function TranslationSettings() {
  const { config, updateConfig } = useSettingsStore();

  const modelOptions = [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-flash-thinking-exp', label: 'Gemini 2.0 Flash Thinking' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5" />
        번역 설정
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 모델 선택 */}
        <Select
          label="모델"
          value={config.modelName}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateConfig({ modelName: e.target.value })}
          options={modelOptions}
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
          max={1}
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

        {/* 프리필 모드 */}
        <div className="md:col-span-2">
          <Checkbox
            label="프리필 번역 모드 사용"
            checked={config.enablePrefillTranslation}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ enablePrefillTranslation: e.target.checked })}
            description="더 자연스러운 번역을 위해 사전 학습된 컨텍스트를 사용합니다."
          />
        </div>

        {/* 용어집 주입 */}
        <div className="md:col-span-2">
          <Checkbox
            label="동적 용어집 주입"
            checked={config.enableDynamicGlossaryInjection}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig({ enableDynamicGlossaryInjection: e.target.checked })}
            description="번역 시 용어집 항목을 프롬프트에 자동으로 포함합니다."
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

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex justify-between items-center text-xl font-semibold text-gray-800"
      >
        <span>📝 프롬프트 설정</span>
        <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
      </button>
      
      {isExpanded && (
        <div className="mt-4">
          <Textarea
            label="번역 프롬프트 템플릿"
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
      <ProgressBar
        value={percentage}
        label={progress?.currentStatusMessage || '준비 중...'}
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

/**
 * 번역 결과 미리보기 컴포넌트
 */
function ResultPreview() {
  const { translatedText, results } = useTranslationStore();
  const { downloadResult } = useTranslation();

  if (!translatedText && results.length === 0) return null;

  const successCount = results.filter((r: { success: boolean }) => r.success).length;
  const failCount = results.filter((r: { success: boolean }) => !r.success).length;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-800">📄 번역 결과</h2>
        <div className="flex gap-2">
          <Button
            variant="primary"
            leftIcon={<Download className="w-4 h-4" />}
            onClick={() => downloadResult()}
            disabled={!translatedText}
          >
            다운로드
          </Button>
        </div>
      </div>

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
          {translatedText || '번역 결과가 여기에 표시됩니다...'}
        </pre>
      </div>
      
      <p className="text-sm text-gray-500 mt-2">
        총 {translatedText.length.toLocaleString()}자
      </p>
    </div>
  );
}

/**
 * 설정 및 번역 페이지 메인 컴포넌트
 */
export function TranslationPage() {
  const { config, exportConfig } = useSettingsStore();
  const { addLog } = useTranslationStore();
  const {
    inputFiles,
    isRunning,
    hasFailedChunks,
    canStart,
    canStop,
    executeTranslation,
    cancelTranslation,
    retryFailedChunks,
  } = useTranslation();

  const handleStartTranslation = useCallback(() => {
    executeTranslation();
  }, [executeTranslation]);

  const handleStopTranslation = useCallback(() => {
    cancelTranslation();
  }, [cancelTranslation]);

  const handleRetryFailed = useCallback(() => {
    retryFailedChunks();
  }, [retryFailedChunks]);

  const handleExportSettings = useCallback(() => {
    exportConfig();
    addLog('info', '설정이 저장되었습니다.');
  }, [exportConfig, addLog]);

  return (
    <div className="space-y-6 fade-in">
      {/* 파일 업로드 */}
      <FileUploadSection />
      
      {/* 번역 설정 */}
      <TranslationSettings />
      
      {/* 프롬프트 설정 */}
      <PromptSettings />
      
      {/* 진행률 */}
      <ProgressSection />
      
      {/* 번역 결과 */}
      <ResultPreview />
      
      {/* 액션 버튼 */}
      <div className="flex gap-4">
        {!isRunning ? (
          <>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canStart}
              leftIcon={<Play className="w-5 h-5" />}
              onClick={handleStartTranslation}
            >
              번역 시작
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
            fullWidth
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
        >
          설정 저장
        </Button>
      </div>
    </div>
  );
}
