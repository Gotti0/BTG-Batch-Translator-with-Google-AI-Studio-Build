
// pages/GlossaryPage.tsx
// 용어집 관리 페이지

import React, { useState, useCallback } from 'react';
import { BookOpen, Plus, Trash2, Download, Upload, Search, Edit2, Check, X, Sparkles, Square, FileText, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { useGlossaryStore } from '../stores/glossaryStore';
import { useTranslationStore } from '../stores/translationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { FileHandler } from '../utils/fileHandler';
import { useGlossary } from '../hooks/useGlossary';
import { DEFAULT_GLOSSARY_EXTRACTION_PROMPT } from '../types/config';
import type { GlossaryEntry } from '../types/dtos';
import { Button, IconButton, Input, Select, Checkbox, ConfirmDialog, ProgressBar, Textarea, Slider } from '../components';

/**
 * 용어집 통계 컴포넌트
 */
function GlossaryStats() {
  const totalEntries = useGlossaryStore((state) => state.entries.length);
  const selectedCount = useGlossaryStore((state) => state.selectedEntries.size);
  const totalOccurrences = useGlossaryStore((state) =>
    state.entries.reduce((sum, e) => sum + e.occurrenceCount, 0)
  );

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="bg-primary-50 rounded-lg p-4 text-center">
        <div className="text-2xl font-bold text-primary-600">{totalEntries}</div>
        <div className="text-sm text-primary-700">총 항목</div>
      </div>
      <div className="bg-green-50 rounded-lg p-4 text-center">
        <div className="text-2xl font-bold text-green-600">{totalOccurrences}</div>
        <div className="text-sm text-green-700">총 등장 횟수</div>
      </div>
      <div className="bg-purple-50 rounded-lg p-4 text-center">
        <div className="text-2xl font-bold text-purple-600">{selectedCount}</div>
        <div className="text-sm text-purple-700">선택됨</div>
      </div>
    </div>
  );
}

/**
 * 용어집 도구 모음 컴포넌트
 */
function GlossaryToolbar() {
  const { 
    searchQuery, 
    setSearchQuery, 
    sortBy, 
    setSortBy, 
    sortOrder, 
    setSortOrder,
    exportToJson,
    selectedEntries,
    removeEntries,
    deselectAll,
  } = useGlossaryStore();

  const { importGlossaryFile } = useGlossary();

  const handleExport = useCallback(() => {
    const json = exportToJson();
    FileHandler.downloadTextFile(json, 'glossary.json', 'application/json');
  }, [exportToJson]);

  const handleImport = useCallback(async () => {
    // 훅의 통합 가져오기 기능 사용 (JSON + CSV 지원 및 로깅 포함)
    await importGlossaryFile();
  }, [importGlossaryFile]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedEntries.size > 0) {
      setShowDeleteConfirm(true);
    }
  }, [selectedEntries]);

  const confirmDelete = useCallback(() => {
    removeEntries([...selectedEntries]);
    deselectAll();
    setShowDeleteConfirm(false);
  }, [selectedEntries, removeEntries, deselectAll]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-4 mb-4">
        {/* 검색 */}
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="검색..."
            className="pl-10"
          />
        </div>

        {/* 정렬 */}
        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          options={[
            { value: 'occurrenceCount', label: '등장 횟수' },
            { value: 'keyword', label: '원문' },
            { value: 'translatedKeyword', label: '번역' },
          ]}
        />

        <Button
          variant="secondary"
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
        >
          {sortOrder === 'asc' ? '↑ 오름차순' : '↓ 내림차순'}
        </Button>

        {/* 액션 버튼들 */}
        <div className="flex gap-2">
          <Button onClick={handleImport}>
            <Upload className="w-4 h-4" />
            가져오기
          </Button>
          <Button variant="secondary" onClick={handleExport}>
            <Download className="w-4 h-4" />
            내보내기
          </Button>
          {selectedEntries.size > 0 && (
            <Button variant="danger" onClick={handleDeleteSelected}>
              <Trash2 className="w-4 h-4" />
              삭제 ({selectedEntries.size})
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        title="항목 삭제"
        message={`${selectedEntries.size}개 항목을 삭제하시겠습니까?`}
        confirmText="삭제"
        cancelText="취소"
        danger
      />
    </>
  );
}

/**
 * 용어집 항목 행 컴포넌트
 */
const GlossaryRow: React.FC<{ entry: GlossaryEntry }> = ({ entry }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedEntry, setEditedEntry] = useState(entry);
  
  const { 
    selectedEntries, 
    toggleSelection, 
    updateEntry, 
    removeEntry 
  } = useGlossaryStore();

  const isSelected = selectedEntries.has(entry.keyword.toLowerCase());

  const handleSave = useCallback(() => {
    updateEntry(entry.keyword, editedEntry);
    setIsEditing(false);
  }, [entry.keyword, editedEntry, updateEntry]);

  const handleCancel = useCallback(() => {
    setEditedEntry(entry);
    setIsEditing(false);
  }, [entry]);

  if (isEditing) {
    return (
      <tr className="bg-yellow-50">
        <td className="px-4 py-2">
          <Checkbox checked={isSelected} disabled label="선택" />
        </td>
        <td className="px-4 py-2">
          <Input
            type="text"
            value={editedEntry.keyword}
            onChange={(e) => setEditedEntry({ ...editedEntry, keyword: e.target.value })}
          />
        </td>
        <td className="px-4 py-2">
          <Input
            type="text"
            value={editedEntry.translatedKeyword}
            onChange={(e) => setEditedEntry({ ...editedEntry, translatedKeyword: e.target.value })}
          />
        </td>
        <td className="px-4 py-2">
          <Input
            type="number"
            value={editedEntry.occurrenceCount}
            onChange={(e) => setEditedEntry({ ...editedEntry, occurrenceCount: parseInt(e.target.value) || 0 })}
            className="w-20"
          />
        </td>
        <td className="px-4 py-2">
          <div className="flex gap-1">
            <IconButton onClick={handleSave} title="저장" aria-label="저장" icon={<Check className="w-4 h-4" />} className="text-green-600 hover:text-green-800" />
            <IconButton onClick={handleCancel} title="취소" aria-label="취소" icon={<X className="w-4 h-4" />} className="text-red-600 hover:text-red-800" />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`hover:bg-gray-50 ${isSelected ? 'bg-primary-50' : ''}`}>
      <td className="px-4 py-2">
        <Checkbox
          checked={isSelected}
          onChange={() => toggleSelection(entry.keyword)}
        />
      </td>
      <td className="px-4 py-2 font-medium">{entry.keyword}</td>
      <td className="px-4 py-2">{entry.translatedKeyword}</td>
      <td className="px-4 py-2 text-center">{entry.occurrenceCount}</td>
      <td className="px-4 py-2">
        <div className="flex gap-1">
          <IconButton
            onClick={() => setIsEditing(true)}
            title="수정"
            aria-label="수정"
            icon={<Edit2 className="w-4 h-4" />}
            className="text-blue-600 hover:text-blue-800"
          />
          <IconButton
            onClick={() => removeEntry(entry.keyword)}
            title="삭제"
            aria-label="삭제"
            icon={<Trash2 className="w-4 h-4" />}
            className="text-red-600 hover:text-red-800"
          />
        </div>
      </td>
    </tr>
  );
};

/**
 * 새 항목 추가 폼 컴포넌트
 */
function AddEntryForm() {
  const [keyword, setKeyword] = useState('');
  const [translatedKeyword, setTranslatedKeyword] = useState('');
  const { addEntry } = useGlossaryStore();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim() && translatedKeyword.trim()) {
      addEntry({
        keyword: keyword.trim(),
        translatedKeyword: translatedKeyword.trim(),
        targetLanguage: 'ko',
        occurrenceCount: 0,
      });
      setKeyword('');
      setTranslatedKeyword('');
    }
  }, [keyword, translatedKeyword, addEntry]);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
      <Input
        type="text"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="원문 용어"
        className="flex-1"
      />
      <Input
        type="text"
        value={translatedKeyword}
        onChange={(e) => setTranslatedKeyword(e.target.value)}
        placeholder="번역어"
        className="flex-1"
      />
      <Button
        type="submit"
        disabled={!keyword.trim() || !translatedKeyword.trim()}
      >
        <Plus className="w-4 h-4" />
        추가
      </Button>
    </form>
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
 * 용어집 자동 추출 섹션 컴포넌트
 */
function GlossaryExtractionSection() {
  const { inputFiles } = useTranslationStore();
  const { config, updateConfig } = useSettingsStore();
  const {
    isExtracting,
    extractionProgress,
    executeExtraction,
    cancelExtraction,
    canExtract,
    entryCount,
  } = useGlossary();
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [customText, setCustomText] = useState('');
  const [useCustomText, setUseCustomText] = useState(false);

  const handleExtract = useCallback(() => {
    if (useCustomText && customText.trim()) {
      executeExtraction(customText);
    } else {
      executeExtraction();
    }
  }, [executeExtraction, useCustomText, customText]);

  const percentage = extractionProgress?.totalSegments
    ? Math.round((extractionProgress.processedSegments / extractionProgress.totalSegments) * 100)
    : 0;

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-4 mb-4 border border-purple-200">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex justify-between items-center text-lg font-semibold text-purple-800"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          AI 용어집 자동 추출
        </span>
        <span className="text-purple-400">{isExpanded ? '▲' : '▼'}</span>
      </button>
      
      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* 소스 선택 */}
          <div className="flex items-center gap-4">
            <Checkbox
              label="사용자 정의 텍스트 사용"
              checked={useCustomText}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUseCustomText(e.target.checked)}
            />
            
            {!useCustomText && (
              <span className="text-sm text-purple-600">
                {inputFiles.length > 0 
                  ? `📁 ${inputFiles.length}개 업로드된 파일에서 추출`
                  : '⚠️ 파일을 먼저 업로드하세요'}
              </span>
            )}
          </div>

          {/* 사용자 정의 텍스트 입력 */}
          {useCustomText && (
            <Textarea
              label="분석할 텍스트"
              value={customText}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomText(e.target.value)}
              placeholder="용어집을 추출할 텍스트를 입력하세요..."
              rows={6}
              className="font-mono text-sm"
            />
          )}

          {/* 추출 상세 설정 (Advanced Settings) */}
          <div className="bg-white/60 rounded-lg p-3 border border-purple-100">
            <button
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="flex items-center gap-2 text-sm font-medium text-purple-700 hover:text-purple-900 transition-colors w-full"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>추출 상세 설정 (청크, 샘플링, 프롬프트)</span>
              <span className="text-xs text-purple-400 ml-auto">{showAdvancedSettings ? '접기 ▲' : '펼치기 ▼'}</span>
            </button>
            
            {showAdvancedSettings && (
              <div className="mt-4 space-y-4 animate-fadeIn">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    type="number"
                    label="청크 크기 (Glossary Chunk Size)"
                    value={config.glossaryChunkSize}
                    onChange={(e) => updateConfig({ glossaryChunkSize: parseInt(e.target.value) || 8000 })}
                    min={1000}
                    step={1000}
                    helperText="텍스트를 분석할 단위 크기 (글자)"
                  />
                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-sm font-medium text-gray-700">샘플링 비율 ({config.glossarySamplingRatio}%)</label>
                    </div>
                    <Slider
                      value={config.glossarySamplingRatio}
                      onChange={(e) => updateConfig({ glossarySamplingRatio: parseInt(e.target.value) || 10 })}
                      min={1}
                      max={100}
                    />
                    <p className="text-xs text-gray-500 mt-1">전체 텍스트 중 분석할 비율 (높을수록 정확도↑ 속도↓)</p>
                  </div>
                </div>
                
                <Textarea
                  label="용어집 추출 프롬프트 (Extraction Prompt)"
                  value={config.glossaryExtractionPrompt}
                  onChange={(e) => updateConfig({ glossaryExtractionPrompt: e.target.value })}
                  rows={6}
                  className="font-mono text-xs"
                  helperText="{novelText}, {target_lang_name}, {target_lang_code} 변수 사용 가능"
                />

                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateConfig({ 
                      glossaryChunkSize: 8000, 
                      glossarySamplingRatio: 10,
                      glossaryExtractionPrompt: DEFAULT_GLOSSARY_EXTRACTION_PROMPT 
                    })}
                    className="text-purple-600 hover:bg-purple-50 text-xs h-8"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    기본값으로 복원
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 진행률 표시 */}
          {isExtracting && extractionProgress && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{extractionProgress.currentStatusMessage}</span>
                {/* [추가] ETA 표시 */}
                {extractionProgress.etaSeconds !== undefined && (
                    <span className="font-mono text-purple-600">
                        예상 소요: {formatTime(extractionProgress.etaSeconds)}
                    </span>
                )}
              </div>
              <ProgressBar
                value={percentage}
                // label은 위에서 커스텀 표시
                showPercentage
                detail={`${extractionProgress.processedSegments}/${extractionProgress.totalSegments} 세그먼트`}
                color="primary"
                striped
                animated
              />
              <div className="text-sm text-purple-600 text-center">
                현재까지 추출된 항목: {extractionProgress.extractedEntriesCount}개
              </div>
            </div>
          )}

          {/* 추출 버튼 */}
          <div className="flex gap-3">
            {!isExtracting ? (
              <Button
                variant="primary"
                onClick={handleExtract}
                disabled={!useCustomText ? !canExtract : !customText.trim()}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Sparkles className="w-4 h-4" />
                용어집 추출 시작
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={cancelExtraction}
              >
                <Square className="w-4 h-4" />
                추출 중지
              </Button>
            )}
            
            {entryCount > 0 && !isExtracting && (
              <span className="flex items-center text-sm text-purple-600">
                ✓ 현재 {entryCount}개 항목 보유
              </span>
            )}
          </div>

          {/* 도움말 */}
          <div className="text-xs text-purple-500 bg-purple-100 rounded p-2">
            💡 <strong>팁:</strong> AI가 텍스트를 분석하여 인물명, 고유명사, 지명, 조직명 등을 자동으로 추출합니다.
            추출된 용어는 번역 시 일관성 유지에 활용됩니다.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 용어집 관리 페이지 메인 컴포넌트
 */
export function GlossaryPage() {
  const { getFilteredEntries, selectAll, deselectAll, selectedEntries, entries } = useGlossaryStore();
  const filteredEntries = getFilteredEntries();

  const allSelected = entries.length > 0 && selectedEntries.size === entries.length;

  return (
    <div className="space-y-6 fade-in">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          용어집 관리
        </h2>

        {/* 통계 */}
        <GlossaryStats />

        {/* AI 용어집 추출 */}
        <GlossaryExtractionSection />

        {/* 도구 모음 */}
        <GlossaryToolbar />

        {/* 새 항목 추가 */}
        <AddEntryForm />

        {/* 용어집 테이블 */}
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left w-10">
                  <Checkbox
                    checked={allSelected}
                    onChange={() => allSelected ? deselectAll() : selectAll()}
                  />
                </th>
                <th className="px-4 py-3 text-left">원문</th>
                <th className="px-4 py-3 text-left">번역</th>
                <th className="px-4 py-3 text-center w-24">등장 횟수</th>
                <th className="px-4 py-3 text-left w-20">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredEntries.length > 0 ? (
                filteredEntries.map((entry) => (
                  <GlossaryRow key={entry.keyword} entry={entry} />
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    {entries.length === 0 
                      ? '용어집이 비어 있습니다. 항목을 추가하거나 파일을 가져오세요.'
                      : '검색 결과가 없습니다.'
                    }
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
