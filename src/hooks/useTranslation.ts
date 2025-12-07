// hooks/useTranslation.ts
// 번역 기능을 위한 커스텀 훅

import { useCallback, useRef, useEffect } from 'react';
import { useTranslationStore } from '../stores/translationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGlossaryStore } from '../stores/glossaryStore';
import { TranslationService } from '../services/TranslationService';
import type { TranslationJobProgress, TranslationResult } from '../types/dtos';

/**
 * 번역 기능을 제공하는 커스텀 훅
 * TranslationService와 스토어를 연결합니다.
 */
export function useTranslation() {
  // 스토어 상태
  const { config } = useSettingsStore();
  const { entries: glossaryEntries } = useGlossaryStore();
  const {
    inputFiles,
    isRunning,
    isPaused,
    progress,
    results,
    translatedText,
    startTranslation,
    stopTranslation,
    updateProgress,
    setResults,
    addResult,
    setTranslatedText,
    addLog,
    combineResultsToText,
  } = useTranslationStore();

  // 서비스 인스턴스 참조
  const serviceRef = useRef<TranslationService | null>(null);
  const isTranslatingRef = useRef(false);

  // 서비스 초기화 또는 업데이트
  const getOrCreateService = useCallback((): TranslationService => {
    if (!serviceRef.current) {
      serviceRef.current = new TranslationService(config);
      
      // 로그 콜백 설정
      serviceRef.current.setLogCallback((entry) => {
        addLog(entry.level, entry.message);
      });
    } else {
      // 설정 업데이트
      serviceRef.current.updateConfig(config);
    }

    // 용어집 설정
    serviceRef.current.setGlossaryEntries(glossaryEntries);

    return serviceRef.current;
  }, [config, glossaryEntries, addLog]);

  // 번역 시작
  const executeTranslation = useCallback(async () => {
    if (inputFiles.length === 0) {
      addLog('warning', '번역할 파일을 선택해주세요.');
      return;
    }

    if (isTranslatingRef.current) {
      addLog('warning', '이미 번역이 진행 중입니다.');
      return;
    }

    isTranslatingRef.current = true;
    startTranslation();

    try {
      const service = getOrCreateService();

      // 모든 파일의 내용을 합침
      const fullText = inputFiles.map(f => f.content).join('\n\n');
      
      addLog('info', `총 ${inputFiles.length}개 파일, ${fullText.length.toLocaleString()}자 번역 시작`);
      addLog('info', `모델: ${config.modelName}, 청크 크기: ${config.chunkSize}`);

      // 진행률 콜백
      const onProgress = (progress: TranslationJobProgress) => {
        updateProgress(progress);
      };

      // 번역 실행
      const translationResults = await service.translateText(fullText, onProgress);

      // 결과 저장
      setResults(translationResults);

      // 결과 텍스트 합치기
      const combinedText = TranslationService.combineResults(translationResults);
      setTranslatedText(combinedText);

      // 완료 로그
      const successCount = translationResults.filter(r => r.success).length;
      const failCount = translationResults.filter(r => !r.success).length;
      
      addLog('info', `번역 완료: 성공 ${successCount}개, 실패 ${failCount}개`);

      if (failCount > 0) {
        addLog('warning', `${failCount}개 청크가 번역에 실패했습니다. 검토 탭에서 확인하세요.`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `번역 중 오류 발생: ${errorMessage}`);
      
      updateProgress({
        totalChunks: 0,
        processedChunks: 0,
        successfulChunks: 0,
        failedChunks: 0,
        currentStatusMessage: `오류: ${errorMessage}`,
        lastErrorMessage: errorMessage,
      });
    } finally {
      isTranslatingRef.current = false;
      stopTranslation();
    }
  }, [
    inputFiles,
    config,
    getOrCreateService,
    startTranslation,
    stopTranslation,
    updateProgress,
    setResults,
    setTranslatedText,
    addLog,
  ]);

  // 번역 중지
  const cancelTranslation = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.requestStop();
    }
    stopTranslation();
    addLog('warning', '번역이 사용자에 의해 중단되었습니다.');
  }, [stopTranslation, addLog]);

  // 실패한 청크 재번역
  const retryFailedChunks = useCallback(async () => {
    const failedResults = results.filter(r => !r.success);
    
    if (failedResults.length === 0) {
      addLog('info', '재시도할 실패한 청크가 없습니다.');
      return;
    }

    if (isTranslatingRef.current) {
      addLog('warning', '이미 번역이 진행 중입니다.');
      return;
    }

    isTranslatingRef.current = true;
    addLog('info', `${failedResults.length}개 실패한 청크 재번역 시작`);

    try {
      const service = getOrCreateService();
      
      const retriedResults = await service.retryFailedChunks(
        results,
        (progress) => updateProgress(progress)
      );

      // 결과 업데이트
      const updatedResults = results.map(r => {
        const retried = retriedResults.find(rr => rr.chunkIndex === r.chunkIndex);
        return retried || r;
      });

      setResults(updatedResults);
      
      // 텍스트 재합성
      const combinedText = TranslationService.combineResults(updatedResults);
      setTranslatedText(combinedText);

      const newSuccessCount = retriedResults.filter(r => r.success).length;
      addLog('info', `재번역 완료: ${newSuccessCount}/${failedResults.length}개 성공`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `재번역 중 오류: ${errorMessage}`);
    } finally {
      isTranslatingRef.current = false;
    }
  }, [results, getOrCreateService, updateProgress, setResults, setTranslatedText, addLog]);

  // 결과 다운로드
  const downloadResult = useCallback((filename?: string) => {
    if (!translatedText) {
      addLog('warning', '다운로드할 번역 결과가 없습니다.');
      return;
    }

    const blob = new Blob([translatedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `translated_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('info', `번역 결과가 다운로드되었습니다: ${a.download}`);
  }, [translatedText, addLog]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (serviceRef.current) {
        serviceRef.current.requestStop();
      }
    };
  }, []);

  return {
    // 상태
    inputFiles,
    isRunning,
    isPaused,
    progress,
    results,
    translatedText,
    
    // 액션
    executeTranslation,
    cancelTranslation,
    retryFailedChunks,
    downloadResult,
    
    // 상태 확인
    canStart: inputFiles.length > 0 && !isRunning,
    canStop: isRunning,
    hasFailedChunks: results.some(r => !r.success),
    hasResults: results.length > 0,
  };
}
