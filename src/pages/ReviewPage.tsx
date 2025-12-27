
// pages/ReviewPage.tsx
// 검토 및 수정 페이지

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  CheckCircle, AlertTriangle, RefreshCw, Copy, Eye, EyeOff, 
  TrendingUp, AlertCircle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Trash2, Edit2, Save, X, Zap, ImageIcon, FileText, Folder
} from 'lucide-react';
import { useTranslationStore } from '../stores/translationStore';
import { useTranslation } from '../hooks/useTranslation';
import { useEpubReview } from '../hooks/useEpubReview';
import type { TranslationResult } from '../types/dtos';
import { Button, IconButton, ButtonGroup, ConfirmDialog } from '../components';
import { QualityCheckService, type RegressionAnalysis, type SuspiciousChunk } from '../services/QualityCheckService';
import JSZip from 'jszip';

/**
 * 이미지 미리보기 컴포넌트
 */
function ImagePreview({ file, imagePath }: { file: File; imagePath: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    const loadImage = async () => {
      try {
        const zip = await JSZip.loadAsync(file);
        const imageFile = zip.file(imagePath);
        if (imageFile) {
          const blob = await imageFile.async('blob');
          objectUrl = URL.createObjectURL(blob);
          setImageUrl(objectUrl);
        }
      } catch (error) {
        console.error('Failed to load image:', error);
      }
    };

    loadImage();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, imagePath]);

  if (!imageUrl) return null;

  return (
    <div className="mb-4 p-2 bg-gray-50 rounded border border-gray-200 inline-block">
      <img src={imageUrl} alt="Context" className="max-h-64 rounded" />
      <div className="text-xs text-gray-500 mt-1 text-center">{imagePath}</div>
    </div>
  );
}

/**
 * 청크 상태 배지 컴포넌트 (수정됨: 품질 이슈 표시 추가)
 */
function StatusBadge({ success, issue }: { success: boolean, issue?: SuspiciousChunk }) {
  if (!success) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
        <AlertTriangle className="w-3 h-3" />
        실패
      </span>
    );
  }

  if (issue) {
    const isOmission = issue.issueType === 'omission';
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${
        isOmission 
          ? 'bg-orange-50 text-orange-700 border-orange-200' 
          : 'bg-yellow-50 text-yellow-700 border-yellow-200'
      }`}>
        {isOmission ? <AlertCircle className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
        {isOmission ? '누락 의심' : '환각 의심'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
      <CheckCircle className="w-3 h-3" />
      성공
    </span>
  );
}

/**
 * 청크 카드 컴포넌트 (React.memo 적용)
 */
interface ChunkCardProps {
  result: TranslationResult;
  qualityIssue?: SuspiciousChunk; // [추가] 품질 이슈 데이터
  meta?: {
    label?: string;
    tag?: string;
    hasImage?: boolean;
    onPreview?: () => React.ReactNode;
  };
  isExpanded: boolean;
  onToggle: (index: number) => void;
  onRetry: (index: number) => void;
  onDiscard: (index: number) => void;
  onUpdate: (index: number, text: string) => void;
}

const ChunkCard = React.memo(function ChunkCard({ 
  result, 
  qualityIssue, // [추가]
  meta,
  isExpanded, 
  onToggle, 
  onRetry, 
  onDiscard, 
  onUpdate 
}: ChunkCardProps) {
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(result.translatedText);

  // ... (기존 핸들러 코드는 동일하게 유지)
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(result.translatedText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }, [result.translatedText]);

  const handleEditClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditedText(result.translatedText);
    setIsEditing(true);
    if (!isExpanded) onToggle(result.chunkIndex);
  }, [isExpanded, onToggle, result.chunkIndex, result.translatedText]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditedText(result.translatedText);
  }, [result.translatedText]);

  const handleSave = useCallback(() => {
    onUpdate(result.chunkIndex, editedText);
    setIsEditing(false);
  }, [onUpdate, result.chunkIndex, editedText]);

  const handleDiscardClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDiscard(result.chunkIndex);
  }, [onDiscard, result.chunkIndex]);

  const handleRetryClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRetry(result.chunkIndex);
  }, [onRetry, result.chunkIndex]);

  const handleToggleClick = useCallback(() => {
    onToggle(result.chunkIndex);
  }, [onToggle, result.chunkIndex]);

  // 길이 비율 계산
  const ratio = result.originalText.length > 0 
    ? (result.translatedText.length / result.originalText.length * 100).toFixed(1)
    : 0;
  
  // [추가] 이슈에 따른 스타일링
  let cardBorderClass = 'border-gray-200';
  let headerBgClass = 'bg-gray-50 hover:bg-gray-100';

  if (!result.success) {
    cardBorderClass = 'border-red-300';
    headerBgClass = 'bg-red-50 hover:bg-red-100';
  } else if (qualityIssue) {
    // 이슈가 있는 경우
    if (qualityIssue.issueType === 'omission') {
      cardBorderClass = 'border-orange-300';
      headerBgClass = 'bg-orange-50 hover:bg-orange-100';
    } else {
      cardBorderClass = 'border-yellow-300';
      headerBgClass = 'bg-yellow-50 hover:bg-yellow-100';
    }
  }

  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${cardBorderClass}`}>
      {/* 헤더 */}
      <div 
        className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${headerBgClass}`}
        onClick={handleToggleClick}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="font-medium text-gray-700 flex-shrink-0">청크 #{result.chunkIndex + 1}</span>
          
          {/* [변경] meta 정보가 있을 때만 렌더링 (텍스트 모드는 렌더링 안 함) */}
          {meta && (
            <div className="flex items-center gap-2 text-xs text-gray-500 flex-shrink-0">
              {meta.label && (
                <span className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border max-w-[150px] truncate" title={meta.label}>
                   <FileText className="w-3 h-3" /> {meta.label}
                </span>
              )}
              {meta.tag && <span className="bg-gray-100 px-1.5 rounded uppercase font-mono">{meta.tag}</span>}
              {meta.hasImage && <ImageIcon className="w-3 h-3 text-blue-500" />}
            </div>
          )}

          {/* [수정] 배지에 issue 전달 */}
          <StatusBadge success={result.success} issue={qualityIssue} />
          
          <span className="text-sm text-gray-500 hidden sm:inline truncate">
            원문 {result.originalText.length}자 → 번역 {result.translatedText.length}자 ({ratio}%)
          </span>
        </div>
        
        {/* 우측 아이콘 버튼들 (기존과 동일) */}
        <div className="flex items-center gap-1">
          {result.success && !isEditing && (
            <IconButton 
              type="button"
              onClick={handleDiscardClick} 
              icon={<Trash2 className="w-4 h-4 pointer-events-none" />} 
              className="text-red-400 hover:text-red-600 hover:bg-red-50 relative z-10"
              title="번역 비우기"
              aria-label="번역 비우기"
            />
          )}
          {!result.success && (
            <IconButton 
              onClick={handleRetryClick} 
              icon={<RefreshCw className="w-4 h-4" />}
              className="text-blue-600 hover:text-blue-800"
              title="즉시 재번역"
              aria-label="즉시 재번역"
            />
          )}
          {!isEditing && (
            <IconButton 
              onClick={handleEditClick} 
              icon={<Edit2 className="w-4 h-4" />}
              className="text-gray-500 hover:text-gray-700" 
              title="직접 수정"
              aria-label="직접 수정"
            />
          )}
          <div className="w-px h-4 bg-gray-300 mx-1"></div>
          <IconButton
            onClick={handleCopy}
            title="복사"
            className="text-gray-600 hover:text-gray-800"
            icon={copyFeedback ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            aria-label="복사"
          />
          {isExpanded ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* 상세 내용 */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* [변경] 미리보기 함수가 있으면 실행 */}
          {meta?.onPreview && meta.onPreview()}

          {/* [추가] 품질 이슈 알림 박스 (확장 시 상단에 표시) */}
          {qualityIssue && (
             <div className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
               qualityIssue.issueType === 'omission' 
                 ? 'bg-orange-100 text-orange-800 border border-orange-200' 
                 : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
             }`}>
               <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
               <div>
                 <p className="font-semibold">
                   {qualityIssue.issueType === 'omission' 
                     ? '번역 내용 누락 가능성이 있습니다.' 
                     : '번역 내용 환각(Hallucination) 가능성이 있습니다.'}
                 </p>
                 <p className="mt-1 opacity-90">
                   회귀 분석 결과 예상되는 길이는 <strong>{qualityIssue.expectedLength}자</strong>이나, 
                   실제 번역은 <strong>{qualityIssue.translatedLength}자</strong>입니다. 
                   (Z-Score: {qualityIssue.zScore})
                 </p>
               </div>
             </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 원문 */}
            <div>
              <h4 className="text-sm font-medium text-gray-600 mb-2">원문</h4>
              <div className="bg-gray-100 rounded-lg p-3 max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">{result.originalText}</pre>
              </div>
            </div>
            
            {/* 번역문 */}
            <div>
              <h4 className="text-sm font-medium text-gray-600 mb-2">번역</h4>
              {isEditing ? (
                <div className="flex flex-col h-full">
                  <textarea 
                    className="w-full flex-1 border rounded-lg p-3 text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-primary-500 min-h-[12rem]"
                    value={editedText} 
                    onChange={(e) => setEditedText(e.target.value)}
                    placeholder="번역 내용을 수정하세요..."
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <Button size="sm" variant="ghost" onClick={handleCancelEdit}>취소</Button>
                    <Button size="sm" variant="primary" onClick={handleSave} leftIcon={<Save className="w-4 h-4"/>}>저장</Button>
                  </div>
                </div>
              ) : (
                <div className={`rounded-lg p-3 max-h-96 overflow-y-auto ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
                  {result.success ? (
                    <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">{result.translatedText}</pre>
                  ) : (
                    <div className="text-red-600">
                      <p className="font-medium flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        번역 실패
                      </p>
                      <p className="text-sm mt-1">{result.error || '알 수 없는 오류'}</p>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="mt-3 bg-white text-red-600 border-red-200 hover:bg-red-50"
                        onClick={handleRetryClick}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> 재번역 시도
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * 검토 통계 컴포넌트 (수정됨: 하단 목록 제거 및 props로 분석 결과 수신)
 */
const ReviewStats = React.memo(function ReviewStats({ 
  results, 
  analysis 
}: { 
  results: TranslationResult[],
  analysis: RegressionAnalysis 
}) {
  const stats = useMemo(() => {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const totalOriginal = results.reduce((sum, r) => sum + r.originalText.length, 0);
    const totalTranslated = successful.reduce((sum, r) => sum + r.translatedText.length, 0);
    
    return {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      totalOriginal,
      totalTranslated,
      averageRatio: totalOriginal > 0 ? (totalTranslated / totalOriginal * 100).toFixed(1) : 0,
    };
  }, [results]);

  if (results.length === 0) return null;

  return (
    <div className="space-y-4 mb-6">
      {/* 기본 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
          <div className="text-sm text-blue-700">전체 청크</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.successful}</div>
          <div className="text-sm text-green-700">성공</div>
        </div>
        <div className="bg-red-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
          <div className="text-sm text-red-700">실패</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">{stats.averageRatio}%</div>
          <div className="text-sm text-purple-700">평균 길이 비율</div>
        </div>
      </div>

      {/* 선형 회귀 분석 통계 (목록 제거됨) */}
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg p-5 border border-indigo-200">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          <h3 className="font-semibold text-indigo-900">회귀 분석 (품질 검사)</h3>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-600">회귀식</div>
            <div className="font-mono text-indigo-700 font-semibold">
              y = {analysis.slope.toFixed(4)}x + {analysis.intercept.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-gray-600">표준편차</div>
            <div className="font-mono text-indigo-700 font-semibold">
              {analysis.stdDev.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-gray-600">의심 청크</div>
            <div className={`font-mono font-semibold ${analysis.suspiciousChunks.length > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {analysis.suspiciousChunks.length}개
            </div>
          </div>
          <div>
            <div className="text-gray-600">분석 대상</div>
            <div className="font-mono text-indigo-700 font-semibold">
              {stats.successful}개
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-indigo-200 text-xs text-indigo-800">
          <p>
            ⚠️ 탐지된 의심 청크는 아래 목록에서 <strong>누락 의심</strong> 또는 <strong>환각 의심</strong> 배지로 표시됩니다.
          </p>
        </div>
      </div>
    </div>
  );
});

// ... (ReviewFilter 컴포넌트는 기존과 동일)
function ReviewFilter({ 
  filter, 
  setFilter 
}: { 
  filter: 'all' | 'success' | 'failed' | 'warning'; // [추가] warning 필터
  setFilter: (f: 'all' | 'success' | 'failed' | 'warning') => void;
}) {
  return (
    <div className="mb-4">
      <ButtonGroup>
        <Button
          onClick={() => setFilter('all')}
          variant={filter === 'all' ? 'primary' : 'secondary'}
        >
          전체
        </Button>
        <Button
          onClick={() => setFilter('success')}
          variant={filter === 'success' ? 'primary' : 'secondary'}
          className={filter === 'success' ? 'bg-green-600 hover:bg-green-700' : ''}
        >
          성공
        </Button>
        <Button
          onClick={() => setFilter('failed')}
          variant={filter === 'failed' ? 'primary' : 'secondary'}
          className={filter === 'failed' ? 'bg-red-600 hover:bg-red-700' : ''}
        >
          실패
        </Button>
        {/* [추가] 의심 항목 필터 */}
        <Button
          onClick={() => setFilter('warning')}
          variant={filter === 'warning' ? 'primary' : 'secondary'}
          className={filter === 'warning' ? 'bg-orange-500 hover:bg-orange-600 text-white' : ''}
        >
          의심 항목
        </Button>
      </ButtonGroup>
    </div>
  );
}

const ITEMS_PER_PAGE = 20;

/**
 * 검토 및 수정 페이지 메인 컴포넌트
 */
export function ReviewPage() {
  const { results, updateResult, combineResultsToText, inputFiles } = useTranslationStore();
  const { retryFailedChunks, retrySingleChunk } = useTranslation();
  
  // [핵심] Custom Hook 사용: 여기서 모든 복잡성을 처리합니다.
  const { 
    isEpubMode, 
    chapters, 
    selectedChapter, 
    setSelectedChapter, 
    getChunkMeta, 
    filterByChapter 
  } = useEpubReview(inputFiles, results);
  
  const [filter, setFilter] = useState<'all' | 'success' | 'failed' | 'warning'>('all');
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [discardTargetIndex, setDiscardTargetIndex] = useState<number | null>(null);

  // [1] 분석 결과를 부모 컴포넌트에서 계산 (Memoization)
  const analysis = useMemo(() => {
    return QualityCheckService.analyzeTranslationQuality(results);
  }, [results]);

  // [2] 의심 청크 Map 생성 (O(1) 조회를 위해)
  const suspiciousChunkMap = useMemo(() => {
    const map = new Map<number, SuspiciousChunk>();
    analysis.suspiciousChunks.forEach(chunk => {
      map.set(chunk.chunkIndex, chunk);
    });
    return map;
  }, [analysis]);

  // 필터링된 결과
  const filteredResults = useMemo(() => {
    // 1. 원본 결과 복사 및 정렬
    let sorted = [...results].sort((a, b) => a.chunkIndex - b.chunkIndex);

    // [추가] 2. 뷰 레벨 중복 제거 (방어 코드)
    const uniqueMap = new Map<number, TranslationResult>();
    sorted.forEach(item => {
        // Map은 키 중복 시 덮어쓰므로, 결과적으로 마지막 항목이 남음
        uniqueMap.set(item.chunkIndex, item);
    });
    sorted = Array.from(uniqueMap.values()).sort((a, b) => a.chunkIndex - b.chunkIndex);

    // 3. 필터 적용
    switch (filter) {
      case 'success':
        sorted = sorted.filter(r => r.success);
        break;
      case 'failed':
        sorted = sorted.filter(r => !r.success);
        break;
      case 'warning': // [추가] 의심 항목 필터링
        sorted = sorted.filter(r => suspiciousChunkMap.has(r.chunkIndex));
        break;
    }
    
    // [추가] 챕터 필터 적용 (훅에서 제공하는 함수 사용)
    sorted = filterByChapter(sorted);

    return sorted;
  }, [results, filter, suspiciousChunkMap, filterByChapter]);

  // 페이지 변경 시 스크롤 상단 이동
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);
  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredResults.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredResults, currentPage]);

  // 페이지 번호 생성 로직 (슬라이딩 윈도우)
  const getPageNumbers = useCallback(() => {
    const maxPagesToShow = 10;
    if (totalPages <= maxPagesToShow) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    // 현재 페이지를 중심으로 윈도우 계산
    let startPage = currentPage - Math.floor(maxPagesToShow / 2);
    
    if (startPage < 1) {
      startPage = 1;
    }
    
    let endPage = startPage + maxPagesToShow - 1;
    
    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    return Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  }, [currentPage, totalPages]);

  const toggleExpand = useCallback((index: number) => {
    setExpandedChunks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedChunks(new Set());
  }, []);

  const executeDiscard = useCallback((chunkIndex: number) => {
    updateResult(chunkIndex, {
      success: false,
      translatedText: '',
      error: '사용자 요청에 의한 재번역 대기'
    });
    combineResultsToText();
  }, [updateResult, combineResultsToText]);

  const handleRequestDiscard = useCallback((chunkIndex: number) => {
    setDiscardTargetIndex(chunkIndex);
  }, []);

  const handleConfirmDiscard = useCallback(() => {
    if (discardTargetIndex !== null) {
      executeDiscard(discardTargetIndex);
      setDiscardTargetIndex(null);
    }
  }, [discardTargetIndex, executeDiscard]);

  const handleUpdateText = useCallback((chunkIndex: number, newText: string) => {
    updateResult(chunkIndex, {
      translatedText: newText,
      success: true,
      error: undefined
    });
    combineResultsToText();
  }, [updateResult, combineResultsToText]);

  const handleSingleRetry = useCallback((chunkIndex: number) => {
    retrySingleChunk(chunkIndex);
  }, [retrySingleChunk]);

  const handleBatchRetry = useCallback(() => {
    retryFailedChunks();
  }, [retryFailedChunks]);

  const handlePageChange = useCallback((newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [totalPages]);

  const hasFailures = useMemo(() => results.some(r => !r.success), [results]);

  return (
    <div className="space-y-6 fade-in">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <CheckCircle className="w-5 h-5" />
            검토 및 수정
          </h2>
          
          <div className="flex gap-2">
            {hasFailures && (
              <Button 
                onClick={handleBatchRetry} 
                variant="secondary"
                size="sm"
                className="bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                leftIcon={<RefreshCw className="w-4 h-4"/>}
              >
                실패/비운 항목 일괄 재번역
              </Button>
            )}
            {results.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={collapseAll}
                disabled={expandedChunks.size === 0}
              >
                모두 접기
              </Button>
            )}
          </div>
        </div>

        {results.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>검토할 번역 결과가 없습니다.</p>
            <p className="text-sm mt-1">먼저 번역을 실행해주세요.</p>
          </div>
        ) : (
          <>
            {/* 통계 (분석 결과 전달) */}
            <ReviewStats results={results} analysis={analysis} />

            {/* 필터 */}
            <ReviewFilter filter={filter} setFilter={setFilter} />

            <div className="flex flex-col md:flex-row gap-6">
              {/* [변경] EPUB 모드일 때만 사이드바 렌더링 */}
              {isEpubMode && (
                <div className="w-full md:w-64 flex-shrink-0">
                  <div className="bg-gray-50 rounded-lg p-3 h-fit sticky top-4">
                    <h3 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <Folder className="w-4 h-4" /> 챕터 ({chapters.length})
                    </h3>
                    <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                      <button 
                        onClick={() => setSelectedChapter('all')}
                        className={`w-full text-left px-3 py-2 rounded text-sm ${selectedChapter === 'all' ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                      >
                        전체 보기
                      </button>
                      {chapters.map((ch, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedChapter(ch)}
                          className={`w-full text-left px-3 py-2 rounded text-sm truncate ${selectedChapter === ch ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                           {ch.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 min-w-0">
                {/* 청크 목록 */}
                <div className="space-y-3">
                  {paginatedResults.map(result => {
                    // [변경] 훅을 통해 메타데이터 가져오기
                    const epubMeta = getChunkMeta(result.chunkIndex);
                    
                    // 메타데이터 prop 구성 (EPUB이 아니면 undefined)
                    const metaProps = epubMeta ? {
                      label: epubMeta.fileName.split('/').pop(),
                      tag: epubMeta.tag,
                      hasImage: !!epubMeta.imagePath,
                      onPreview: epubMeta.imagePath && epubMeta.epubFile
                        ? () => <ImagePreview file={epubMeta.epubFile!} imagePath={epubMeta.imagePath!} />
                        : undefined
                    } : undefined;

                    return (
                      <ChunkCard
                        key={result.chunkIndex}
                        result={result}
                        // [중요] 해당 청크의 품질 이슈 전달
                        qualityIssue={suspiciousChunkMap.get(result.chunkIndex)}
                        meta={metaProps}
                        isExpanded={expandedChunks.has(result.chunkIndex)}
                        onToggle={toggleExpand}
                        onRetry={handleSingleRetry}
                        onDiscard={handleRequestDiscard}
                        onUpdate={handleUpdateText}
                      />
                    );
                  })}
                </div>

                {/* 페이지네이션 컨트롤 */}
                {totalPages > 1 && (
                  <div className="flex justify-center items-center gap-1 mt-6 select-none">
                    {/* 맨 처음 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePageChange(1)}
                      disabled={currentPage === 1}
                      title="첫 페이지"
                      className="px-2"
                    >
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>

                    {/* 이전 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      title="이전 페이지"
                      className="px-2"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>

                    {/* 숫자 페이지네이션 (슬라이딩 윈도우) */}
                    <div className="flex items-center gap-1 mx-2">
                      {getPageNumbers().map(pageNum => (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`
                            min-w-[32px] h-8 flex items-center justify-center rounded-md text-sm font-medium transition-colors
                            ${currentPage === pageNum 
                              ? 'bg-primary-600 text-white shadow-sm' 
                              : 'text-gray-700 hover:bg-gray-100'
                            }
                          `}
                        >
                          {pageNum}
                        </button>
                      ))}
                    </div>

                    {/* 다음 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      title="다음 페이지"
                      className="px-2"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>

                    {/* 맨 끝 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePageChange(totalPages)}
                      disabled={currentPage === totalPages}
                      title="마지막 페이지"
                      className="px-2"
                    >
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {filteredResults.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    해당 필터에 맞는 결과가 없습니다.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={discardTargetIndex !== null}
        onClose={() => setDiscardTargetIndex(null)}
        onConfirm={handleConfirmDiscard}
        title="번역 비우기"
        message="이 청크의 번역 내용을 비우고 '실패' 상태로 변경하시겠습니까? (나중에 일괄 재번역할 수 있습니다)"
        confirmText="비우기"
        cancelText="취소"
        danger
      />
    </div>
  );
}
