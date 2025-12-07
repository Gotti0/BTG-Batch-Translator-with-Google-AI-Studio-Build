// pages/ReviewPage.tsx
// 검토 및 수정 페이지

import React, { useState, useMemo } from 'react';
import { CheckCircle, AlertTriangle, RefreshCw, Copy, Eye, EyeOff } from 'lucide-react';
import { useTranslationStore } from '../stores/translationStore';
import type { TranslationResult } from '../types/dtos';
import { Button, IconButton, ButtonGroup } from '../components';

/**
 * 청크 상태 배지 컴포넌트
 */
function StatusBadge({ success }: { success: boolean }) {
  return success ? (
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
      <CheckCircle className="w-3 h-3" />
      성공
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs">
      <AlertTriangle className="w-3 h-3" />
      실패
    </span>
  );
}

/**
 * 청크 카드 컴포넌트
 */
function ChunkCard({ 
  result, 
  isExpanded, 
  onToggle,
  onRetry,
}: { 
  result: TranslationResult;
  isExpanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const [copyFeedback, setCopyFeedback] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.translatedText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // 길이 비율 계산
  const ratio = result.originalText.length > 0 
    ? (result.translatedText.length / result.originalText.length * 100).toFixed(1)
    : 0;

  return (
    <div className={`border rounded-lg overflow-hidden ${result.success ? 'border-gray-200' : 'border-red-300'}`}>
      {/* 헤더 */}
      <div 
        className={`flex items-center justify-between px-4 py-3 cursor-pointer ${
          result.success ? 'bg-gray-50 hover:bg-gray-100' : 'bg-red-50 hover:bg-red-100'
        }`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-700">청크 #{result.chunkIndex + 1}</span>
          <StatusBadge success={result.success} />
          <span className="text-sm text-gray-500">
            원문 {result.originalText.length}자 → 번역 {result.translatedText.length}자 ({ratio}%)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!result.success && (
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              title="재번역"
              className="text-blue-600 hover:text-blue-800"
            >
              <RefreshCw className="w-4 h-4" />
            </IconButton>
          )}
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            title="복사"
            className="text-gray-600 hover:text-gray-800"
          >
            {copyFeedback ? <CheckCircle className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
          </IconButton>
          {isExpanded ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* 상세 내용 */}
      {isExpanded && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 원문 */}
          <div>
            <h4 className="text-sm font-medium text-gray-600 mb-2">원문</h4>
            <div className="bg-gray-100 rounded-lg p-3 max-h-48 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-700">{result.originalText}</pre>
            </div>
          </div>
          
          {/* 번역문 */}
          <div>
            <h4 className="text-sm font-medium text-gray-600 mb-2">번역</h4>
            <div className={`rounded-lg p-3 max-h-48 overflow-y-auto ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
              {result.success ? (
                <pre className="whitespace-pre-wrap text-sm text-gray-700">{result.translatedText}</pre>
              ) : (
                <div className="text-red-600">
                  <p className="font-medium">번역 실패</p>
                  <p className="text-sm mt-1">{result.error || '알 수 없는 오류'}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 검토 통계 컴포넌트
 */
function ReviewStats({ results }: { results: TranslationResult[] }) {
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
  );
}

/**
 * 필터 컴포넌트
 */
function ReviewFilter({ 
  filter, 
  setFilter 
}: { 
  filter: 'all' | 'success' | 'failed';
  setFilter: (f: 'all' | 'success' | 'failed') => void;
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
      </ButtonGroup>
    </div>
  );
}

/**
 * 검토 및 수정 페이지 메인 컴포넌트
 */
export function ReviewPage() {
  const { results } = useTranslationStore();
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());

  // 필터링된 결과
  const filteredResults = useMemo(() => {
    const sorted = [...results].sort((a, b) => a.chunkIndex - b.chunkIndex);
    switch (filter) {
      case 'success':
        return sorted.filter(r => r.success);
      case 'failed':
        return sorted.filter(r => !r.success);
      default:
        return sorted;
    }
  }, [results, filter]);

  const toggleExpand = (index: number) => {
    setExpandedChunks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    setExpandedChunks(new Set(filteredResults.map(r => r.chunkIndex)));
  };

  const collapseAll = () => {
    setExpandedChunks(new Set());
  };

  const handleRetry = (chunkIndex: number) => {
    // TODO: 재번역 로직 구현
    console.log('재번역 요청:', chunkIndex);
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <CheckCircle className="w-5 h-5" />
            검토 및 수정
          </h2>
          
          {results.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={expandAll}
              >
                모두 펼치기
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={collapseAll}
              >
                모두 접기
              </Button>
            </div>
          )}
        </div>

        {results.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>검토할 번역 결과가 없습니다.</p>
            <p className="text-sm mt-1">먼저 번역을 실행해주세요.</p>
          </div>
        ) : (
          <>
            {/* 통계 */}
            <ReviewStats results={results} />

            {/* 필터 */}
            <ReviewFilter filter={filter} setFilter={setFilter} />

            {/* 청크 목록 */}
            <div className="space-y-3">
              {filteredResults.map(result => (
                <ChunkCard
                  key={result.chunkIndex}
                  result={result}
                  isExpanded={expandedChunks.has(result.chunkIndex)}
                  onToggle={() => toggleExpand(result.chunkIndex)}
                  onRetry={() => handleRetry(result.chunkIndex)}
                />
              ))}
            </div>

            {filteredResults.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                해당 필터에 맞는 결과가 없습니다.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
