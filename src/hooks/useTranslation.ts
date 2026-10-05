
// hooks/useTranslation.ts
// 번역 기능을 위한 커스텀 훅

import { useCallback, useRef, useEffect } from 'react';
import { useTranslationStore } from '../stores/translationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGlossaryStore } from '../stores/glossaryStore';
import { TranslationService } from '../services/TranslationService';
import { EpubService } from '../services/EpubService';
import { SnapshotService } from '../services/SnapshotService';
import { notifyWorkStarted, notifyWorkFinished } from '../services/SoundNotificationService';
import { toast } from '../stores/toastStore';
import { useProjectStore } from '../stores/projectStore';
import { triggerDownload, getOutputBaseName } from '../utils/downloadUtils';
import { validateEpubExportRequirements, prepareGlossaryForEpubExport } from '../utils/epubExportUtils';
import type { TranslationJobProgress, TranslationResult, TranslationContext } from '../types/dtos';

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
    updateResult,
    setTranslatedText,
    combineResultsToText, // 텍스트 재합성 함수 가져오기
    addLog,
    restoreSession,
    translationMode,
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

      // 429로 작업이 멈추면 어떤 한도에 걸렸는지 바로 보이도록 알린다
      serviceRef.current.setRateLimitCallback((details) => {
        toast.error(
          `${details.formattedSummary}\n이미 보낸 요청만 마무리하고 번역을 멈춥니다.`,
          '429 Rate Limit',
          8000
        );
      });
    } else {
      // 설정 업데이트
      serviceRef.current.updateConfig(config);
    }

    return serviceRef.current;
  }, [config, addLog]);

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

    // results 변수는 클로저에 의해 캡처된 상태이므로 startTranslation() 호출 전의 값을 가집니다.
    // 따라서 resume 기능을 위한 기존 결과를 여기서 확보할 수 있습니다.
    const existingResults = results.length > 0 ? results : undefined;

    isTranslatingRef.current = true;
    // 번역 전 상태를 지금까지의 자동 스냅샷에 마저 남기고, 이번 실행은 새 자동 스냅샷에 기록한다
    await SnapshotService.beginNewAutoSession();
    startTranslation();
    notifyWorkStarted(config);
    let completed = false;

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

      // 실시간 결과 콜백
      const onResult = (result: TranslationResult) => {
        addResult(result);
      };

      const context: TranslationContext = { glossaryEntries };

      if (translationMode === 'integrity') {
        addLog('info', '🔒 무결성 보장 모드로 번역을 시작합니다. (줄 단위 노드)');

        const { text, results: integrityResults } = await service.translateTextWithIntegrityGuarantee(
          fullText,
          context,
          onProgress,
          onResult
        );

        setResults(integrityResults);
        setTranslatedText(text);

        const successCount = integrityResults.filter(r => r.success).length;
        const failCount = integrityResults.filter(r => !r.success).length;
        addLog('info', `번역 완료: 성공 ${successCount}개, 실패 ${failCount}개 (무결성 모드)`);
        if (failCount > 0) {
          addLog('warning', `${failCount}개 청크가 번역에 실패했습니다. 검토 탭에서 확인하세요.`);
        }
      } else {
        // 기본 모드 번역 실행
        const translationResults = await service.translateText(
          fullText, 
          context,
          onProgress, 
          existingResults,
          onResult
        );

        setResults(translationResults);

        const combinedText = TranslationService.combineResults(translationResults);
        setTranslatedText(combinedText);

        const successCount = translationResults.filter(r => r.success).length;
        const failCount = translationResults.filter(r => !r.success).length;
        
        addLog('info', `번역 완료: 성공 ${successCount}개, 실패 ${failCount}개`);

        if (failCount > 0) {
          addLog('warning', `${failCount}개 청크가 번역에 실패했습니다. 검토 탭에서 확인하세요.`);
        }
      }
      completed = true;

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
      notifyWorkFinished({ enableSoundNotification: config.enableSoundNotification, completed });
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
    addResult,
    setTranslatedText,
    addLog,
    translationMode,
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
    await SnapshotService.beginNewAutoSession();
    notifyWorkStarted(config);
    let completed = false;

    const service = getOrCreateService();
    const onProgress = (progress: TranslationJobProgress) => updateProgress(progress);
    const onResult = (result: TranslationResult) => updateResult(result.chunkIndex, result);

    const isEpubMode = inputFiles[0]?.isEpub;
    const context: TranslationContext = { glossaryEntries };

    try {
      let retriedResults;
      let reconstructedText: string | undefined;

      if (isEpubMode) {
        // EPUB 모드 재시도
        const allNodes = inputFiles[0]?.epubChapters?.flatMap((ch: any) => ch.nodes) || [];
        if (allNodes.length === 0) {
          throw new Error('EPUB 재시도 실패: 원본 노드 정보를 찾을 수 없습니다.');
        }
        addLog('info', 'EPUB 모드로 재번역을 실행합니다.');
        retriedResults = await service.retryFailedEpubChunks(
          results,
          allNodes,
          context,
          onProgress,
          onResult
        );
      } else if (translationMode === 'integrity') {
        // 🔒 무결성 모드 재시도
        addLog('info', '🔒 무결성 모드로 재번역을 실행합니다.');
        const fullText = inputFiles.map(f => f.content).join('\n\n');
        
        const { text, results: integrityResults } = await service.retryFailedIntegrityChunks(
          results,
          fullText,
          context,
          onProgress,
          onResult
        );
        
        retriedResults = integrityResults;
        reconstructedText = text;
      } else {
        // 기본 텍스트 모드 재시도
        addLog('info', '텍스트 모드로 재번역을 실행합니다.');
        retriedResults = await service.retryFailedChunks(
          results,
          context,
          onProgress,
          onResult
        );
      }

      // 결과 업데이트 (최종 동기화)
      setResults(retriedResults);
      
      // 텍스트 재합성
      if (!isEpubMode) {
        if (translationMode === 'integrity' && reconstructedText) {
          // 무결성 모드: 이미 복원된 텍스트 사용
          setTranslatedText(reconstructedText);
        } else {
          // 기본 모드: 결과 조합
          const combinedText = TranslationService.combineResults(retriedResults);
          setTranslatedText(combinedText);
        }
      }

      const newSuccessCount = retriedResults.filter(r => r.success).length;
      const totalRetried = failedResults.length;
      const finalSuccessCount = retriedResults.filter(r => !results.find(pr => pr.chunkIndex === r.chunkIndex)?.success && r.success).length;

      addLog('info', `재번역 완료: ${finalSuccessCount}/${totalRetried}개 청크 재번역 성공`);
      completed = true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `재번역 중 오류: ${errorMessage}`);
    } finally {
      isTranslatingRef.current = false;
      stopTranslation(); // isRunning 상태를 false로 변경
      notifyWorkFinished({ enableSoundNotification: config.enableSoundNotification, completed });
    }
  }, [results, inputFiles, config, getOrCreateService, updateProgress, setResults, updateResult, setTranslatedText, addLog, stopTranslation, translationMode]);

  // [NEW] 단일 청크 즉시 재번역
  const retrySingleChunk = useCallback(async (chunkIndex: number) => {
    // 1. 작업 중복 방지 체크
    if (isTranslatingRef.current) {
      addLog('warning', '이미 다른 작업이 진행 중입니다.');
      return;
    }

    // 2. 대상 청크 데이터 확보
    const targetResult = results.find(r => r.chunkIndex === chunkIndex);
    if (!targetResult) {
      addLog('error', `청크 #${chunkIndex + 1} 정보를 찾을 수 없습니다.`);
      return;
    }

    isTranslatingRef.current = true;
    addLog('info', `청크 #${chunkIndex + 1} 개별 재번역 시작...`);

    try {
      const service = getOrCreateService();
      // 직전 작업이 429로 멈춰 있으면 게이트가 닫혀 있으므로 새 작업으로 연다
      service.resetStop();
      const context: TranslationContext = { glossaryEntries };

      // 3. 단일 청크 번역 요청 (안전 모드 재시도 활성화)
      const newResult = await service.translateChunk(
        targetResult.originalText,
        chunkIndex,
        context,
        true 
      );

      // 4. 결과 업데이트 및 전체 텍스트 동기화
      updateResult(chunkIndex, newResult);
      combineResultsToText(); // 전체 텍스트 갱신

      if (newResult.success) {
        addLog('info', `청크 #${chunkIndex + 1} 재번역 완료`);
      } else {
        addLog('error', `청크 #${chunkIndex + 1} 재번역 실패: ${newResult.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('error', `재번역 오류: ${errorMessage}`);
    } finally {
      isTranslatingRef.current = false;
    }
  }, [results, getOrCreateService, updateResult, combineResultsToText, addLog]);

  // 결과 다운로드
  const downloadResult = useCallback((filename?: string) => {
    if (!translatedText) {
      addLog('warning', '다운로드할 번역 결과가 없습니다.');
      return;
    }

    const downloadName = filename || `${getOutputBaseName(inputFiles)}.txt`;
    triggerDownload(new Blob([translatedText], { type: 'text/plain;charset=utf-8' }), downloadName);
    addLog('info', `번역 결과가 다운로드되었습니다: ${downloadName}`);
  }, [translatedText, inputFiles, addLog]);

  // 텍스트 번역본을 EPUB 전자책으로 내보내기
  const downloadEpubResult = useCallback(async (filename?: string) => {
    const project = useProjectStore.getState().project;
    const completedResults = results
      .filter((r) => r.success && r.translatedText?.trim())
      .sort((a, b) => a.chunkIndex - b.chunkIndex);

    const validation = validateEpubExportRequirements(project, completedResults.length > 0);
    if (!validation.valid) {
      toast.warning(validation.error || 'EPUB으로 내보낼 수 없습니다.', 'EPUB 내보내기');
      return;
    }

    const glossaryTerms = config.attachGlossaryToEnd ? prepareGlossaryForEpubExport(glossaryEntries) : [];
    addLog(
      'info',
      `📖 EPUB 생성 시작: "${project.title}" (청크 ${completedResults.length}개, ${config.epubSplitMode === 'delimiter' ? '구분자' : '청크'} 단위 분할${config.attachGlossaryToEnd ? `, 부록 용어집 ${glossaryTerms.length}개` : ''})`
    );

    try {
      const epubBlob = await new EpubService().createEpubFromTextChunks({
        title: project.title.trim(),
        author: project.author.trim(),
        description: project.description,
        coverImageDataUrl: validation.coverImage,
        // 무결성 모드 결과는 줄바꿈(\n)으로, 기본 모드 결과는 원문 개행을 그대로 담고 있다
        chunks: completedResults.map((r) => ({ chunkIndex: r.chunkIndex, text: r.translatedText })),
        glossaryTerms,
        splitMode: config.epubSplitMode,
        delimiterRegex: config.epubDelimiterRegex,
        delimiterMinDistance: config.epubDelimiterMinDistance,
      });

      const downloadName = filename || `${getOutputBaseName(inputFiles)}.epub`;
      triggerDownload(epubBlob, downloadName);
      addLog('info', `EPUB 전자책이 다운로드되었습니다: ${downloadName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`EPUB 생성 실패: ${message}`, 'EPUB 내보내기');
    }
  }, [results, inputFiles, glossaryEntries, config, addLog]);

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
    retrySingleChunk, // [NEW]
    downloadResult,
    downloadEpubResult,
    
    // 상태 확인
    canStart: inputFiles.length > 0 && !isRunning,
    canStop: isRunning,
    hasFailedChunks: results.some(r => !r.success),
    hasResults: results.length > 0,
  };
}
