// pages/LogPage.tsx
// 실행 로그 페이지

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ScrollText, Trash2, Download, Filter, ArrowDown } from 'lucide-react';
import { useTranslationStore } from '../stores/translationStore';
import { FileHandler } from '../utils/fileHandler';
import type { LogEntry } from '../types/dtos';
import { Button, ConfirmDialog } from '../components';

/**
 * 로그 레벨 배지 컴포넌트
 */
const LogLevelBadge: React.FC<{ level: LogEntry['level'] }> = ({ level }) => {
  const styles = {
    info: 'bg-blue-100 text-blue-700',
    warning: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700',
    debug: 'bg-gray-100 text-gray-700',
  };

  const labels = {
    info: 'INFO',
    warning: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono ${styles[level]}`}>
      {labels[level]}
    </span>
  );
};

/**
 * 로그 항목 컴포넌트
 */
const LogItem: React.FC<{ log: LogEntry }> = ({ log }) => {
  const timeStr = log.timestamp.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const textColor = {
    info: 'text-gray-300',
    warning: 'text-yellow-400',
    error: 'text-red-400',
    debug: 'text-gray-500',
  };

  return (
    <div className="flex items-start gap-3 py-1.5 px-3 hover:bg-gray-800/50">
      <span className="text-gray-500 font-mono text-sm whitespace-nowrap">{timeStr}</span>
      <LogLevelBadge level={log.level} />
      <span className={`font-mono text-sm ${textColor[log.level]}`}>{log.message}</span>
    </div>
  );
};

/**
 * 필터 버튼 컴포넌트
 */
const FilterButton: React.FC<{ 
  level: LogEntry['level'] | 'all';
  active: boolean;
  count: number;
  onClick: () => void;
}> = ({ 
  level, 
  active, 
  count, 
  onClick 
}) => {
  const getVariant = (): 'primary' | 'secondary' | 'danger' | 'ghost' => {
    if (!active) return 'ghost';
    return 'primary';
  };

  const styles = {
    all: active ? 'bg-gray-600 hover:bg-gray-700' : '',
    info: active ? 'bg-blue-600 hover:bg-blue-700' : 'text-blue-700',
    warning: active ? 'bg-yellow-600 hover:bg-yellow-700' : 'text-yellow-700',
    error: active ? 'bg-red-600 hover:bg-red-700' : 'text-red-700',
    debug: active ? 'bg-gray-500 hover:bg-gray-600' : 'text-gray-600',
  };

  const labels = {
    all: '전체',
    info: 'INFO',
    warning: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG',
  };

  return (
    <Button
      onClick={onClick}
      variant={getVariant()}
      size="sm"
      className={styles[level]}
    >
      {labels[level]} ({count})
    </Button>
  );
};

/**
 * 실행 로그 페이지 메인 컴포넌트
 */
export function LogPage() {
  const { logs, clearLogs, addLog } = useTranslationStore();
  const [filter, setFilter] = useState<LogEntry['level'] | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // 필터링된 로그
  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter(log => log.level === filter);
  }, [logs, filter]);

  // 레벨별 카운트
  const counts = useMemo(() => ({
    all: logs.length,
    info: logs.filter(l => l.level === 'info').length,
    warning: logs.filter(l => l.level === 'warning').length,
    error: logs.filter(l => l.level === 'error').length,
    debug: logs.filter(l => l.level === 'debug').length,
  }), [logs]);

  // 자동 스크롤
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // 로그 내보내기
  const handleExport = () => {
    const content = logs
      .map(log => `[${log.timestamp.toISOString()}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    const filename = `btg_log_${new Date().toISOString().slice(0, 10)}.txt`;
    FileHandler.downloadTextFile(content, filename);
  };

  // 로그 지우기
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClear = () => {
    if (logs.length > 0) {
      setShowClearConfirm(true);
    }
  };

  const confirmClear = () => {
    clearLogs();
    setShowClearConfirm(false);
  };

  // 테스트 로그 추가 (개발용)
  const addTestLogs = () => {
    addLog('info', '테스트 정보 메시지입니다.');
    addLog('warning', '테스트 경고 메시지입니다.');
    addLog('error', '테스트 오류 메시지입니다.');
    addLog('debug', '테스트 디버그 메시지입니다.');
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <ScrollText className="w-5 h-5" />
            실행 로그
          </h2>
          
          <div className="flex gap-2">
            <Button
              onClick={() => setAutoScroll(!autoScroll)}
              variant={autoScroll ? 'primary' : 'secondary'}
              size="sm"
              className={autoScroll ? 'bg-primary-100 text-primary-700 hover:bg-primary-200' : ''}
            >
              <ArrowDown className="w-4 h-4" />
              자동 스크롤
            </Button>
            <Button
              onClick={handleExport}
              disabled={logs.length === 0}
              size="sm"
              className="bg-green-600 hover:bg-green-700"
            >
              <Download className="w-4 h-4" />
              내보내기
            </Button>
            <Button
              onClick={handleClear}
              disabled={logs.length === 0}
              variant="danger"
              size="sm"
            >
              <Trash2 className="w-4 h-4" />
              지우기
            </Button>
          </div>
        </div>

        {/* 필터 */}
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-gray-400" />
          <FilterButton level="all" active={filter === 'all'} count={counts.all} onClick={() => setFilter('all')} />
          <FilterButton level="info" active={filter === 'info'} count={counts.info} onClick={() => setFilter('info')} />
          <FilterButton level="warning" active={filter === 'warning'} count={counts.warning} onClick={() => setFilter('warning')} />
          <FilterButton level="error" active={filter === 'error'} count={counts.error} onClick={() => setFilter('error')} />
          <FilterButton level="debug" active={filter === 'debug'} count={counts.debug} onClick={() => setFilter('debug')} />
        </div>

        {/* 로그 콘솔 */}
        <div
          ref={logContainerRef}
          className="bg-gray-900 rounded-lg h-96 overflow-y-auto font-mono"
        >
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log, index) => (
              <LogItem key={`${log.timestamp.getTime()}-${index}`} log={log} />
            ))
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              {logs.length === 0 ? (
                <div className="text-center">
                  <ScrollText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>로그가 없습니다.</p>
                  <Button
                    onClick={addTestLogs}
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-primary-400 hover:text-primary-300"
                  >
                    테스트 로그 추가
                  </Button>
                </div>
              ) : (
                <p>해당 필터에 맞는 로그가 없습니다.</p>
              )}
            </div>
          )}
        </div>

        {/* 통계 */}
        <div className="flex justify-between items-center mt-3 text-sm text-gray-500">
          <span>
            {filteredLogs.length === logs.length 
              ? `${logs.length}개 로그`
              : `${filteredLogs.length} / ${logs.length}개 표시`
            }
          </span>
          <span>
            마지막 업데이트: {logs.length > 0 
              ? logs[logs.length - 1].timestamp.toLocaleTimeString('ko-KR')
              : '-'
            }
          </span>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={confirmClear}
        title="로그 삭제"
        message="모든 로그를 삭제하시겠습니까?"
        confirmText="삭제"
        cancelText="취소"
        danger
      />
    </div>
  );
}