// hooks/useTranslation.ts
// 번역 기능을 위한 커스텀 훅

import { useCallback, useRef, useEffect } from 'react';
import { useTranslationStore } from '../stores/translationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGlossaryStore } from '../stores/glossaryStore';
import { TranslationService } from '../services/TranslationService';
import { ChunkService } from '../services/ChunkService';
import type { TranslationJobProgress, TranslationResult, TranslationSnapshot, FileContent } from '../types/dtos';

/**
 * 번역 기능을 제공하는 커스텀 훅
 * TranslationService와 스토어를 연결합니다.
 */
export function useTranslation() {
  // 스토어 상태
  const { config, updateConfig } = useSettingsStore();
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
    restoreSession,
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

      // 기존 결과 (이어하기인 경우)
      const existingResults = results.length > 0 ? results : undefined;

      // 번역 실행
      const translationResults = await service.translateText(fullText, onProgress, existingResults);

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
    results, // existingResults 참조를 위해 추가
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

  // === 작업 이어하기(Snapshot) 기능 ===

  /**
   * 현재 작업을 스냅샷(JSON)으로 내보내기
   */
  const exportSnapshot = useCallback(() => {
    if (inputFiles.length === 0) {
      addLog('warning', '내보낼 작업이 없습니다.');
      return;
    }

    const successfulChunks = results.filter(r => r.success);
    const totalChunks = progress?.totalChunks || results.length;
    
    const sourceText = inputFiles.map(f => f.content).join('\n\n');
    
    // Snake Case로 변환
    const snapshot: TranslationSnapshot = {
      meta: {
        version: '1.0',
        created_at: new Date().toISOString(),
        app_version: '0.0.2',
      },
      source_info: {
        file_name: inputFiles[0]?.name || 'unknown.txt',
        file_size: sourceText.length,
      },
      config: {
        chunk_size: config.chunkSize,
        model_name: config.modelName,
        prompt_template: config.prompts,
      },
      source_text: sourceText,
      progress: {
        total_chunks: totalChunks,
        processed_chunks: successfulChunks.length,
      },
      translated_chunks: {},
    };

    // 청크 맵핑
    results.forEach(result => {
      if (result.success) {
        snapshot.translated_chunks[result.chunkIndex.toString()] = {
          original_text: result.originalText,
          translated_text: result.translatedText,
          status: 'success',
        };
      }
    });

    // 파일 다운로드
    const jsonStr = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `btg_snapshot_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('info', `작업 스냅샷이 저장되었습니다: ${a.download}`);
  }, [inputFiles, results, progress, config, addLog]);

  /**
   * 스냅샷(JSON) 파일을 불러와 작업 복구
   */
  const importSnapshot = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const snapshot: TranslationSnapshot = JSON.parse(text);

      // 1. 유효성 검사
      if (!snapshot.source_text || !snapshot.config?.chunk_size) {
        addLog('error', '유효하지 않은 스냅샷 파일입니다. (필수 필드 누락)');
        return;
      }

      // 2. 설정 복구 (청크 사이즈가 가장 중요)
      updateConfig({
        chunkSize: snapshot.config.chunk_size,
        modelName: snapshot.config.model_name || config.modelName,
        prompts: snapshot.config.prompt_template || config.prompts,
      });

      addLog('info', `설정이 복구되었습니다. (청크 크기: ${snapshot.config.chunk_size})`);

      // 3. 원본 텍스트 재구성
      const restoredFile: FileContent = {
        name: snapshot.source_info.file_name || 'restored_source.txt',
        content: snapshot.source_text,
        size: snapshot.source_info.file_size || 0,
        lastModified: Date.now(),
      };

      // 4. 청크 재분할 및 결과 매핑
      // 청크 서비스 직접 사용해 원본을 다시 나눔
      const chunkService = new ChunkService(snapshot.config.chunk_size);
      const chunks = chunkService.splitTextIntoChunks(snapshot.source_text);
      
      const restoredResults: TranslationResult[] = [];
      let successfulCount = 0;

      chunks.forEach((chunkText, index) => {
        const savedChunk = snapshot.translated_chunks[index.toString()];
        
        if (savedChunk && savedChunk.status === 'success') {
          // 저장된 결과가 있는 경우
          restoredResults.push({
            chunkIndex: index,
            originalText: chunkText, // 스냅샷의 original_text 대신 재분할된 텍스트 사용 (정합성 보장)
            translatedText: savedChunk.translated_text,
            success: true,
          });
          successfulCount++;
        } else {
          // 결과가 없는 경우 (미번역) - 나중에 번역될 때 채워짐
          // TranslationStore의 results 배열은 번역된 것만 넣거나, 
          // 진행 중 상태를 위해 빈 객체를 넣을 수도 있으나,
          // 여기서는 '완료된 것'만 복구하고 나머지는 번역 실행 시 처리하도록 함.
        }
      });

      // 5. 스토어 상태 복구
      const restoredProgress: TranslationJobProgress = {
        totalChunks: chunks.length,
        processedChunks: successfulCount,
        successfulChunks: successfulCount,
        failedChunks: 0,
        currentStatusMessage: '작업 복구 완료. 번역 시작을 눌러 이어하세요.',
      };

      restoreSession([restoredFile], restoredResults, restoredProgress);

      addLog('info', `작업이 복구되었습니다. 총 ${chunks.length}개 중 ${successfulCount}개 완료됨.`);
      addLog('info', '번역 시작 버튼을 누르면 나머지 구간부터 작업을 이어갑니다.');

    } catch (error) {
      addLog('error', `스냅샷 불러오기 실패: ${error}`);
      console.error(error);
    }
  }, [config, updateConfig, restoreSession, addLog]);

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
    
    // 스냅샷 액션
    exportSnapshot,
    importSnapshot,
    
    // 상태 확인
    canStart: inputFiles.length > 0 && !isRunning,
    canStop: isRunning,
    hasFailedChunks: results.some(r => !r.success),
    hasResults: results.length > 0,
  };
}