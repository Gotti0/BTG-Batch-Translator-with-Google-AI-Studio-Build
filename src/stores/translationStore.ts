// stores/translationStore.ts
// 번역 작업 상태 관리 (Zustand)

import { create } from 'zustand';
import type { 
  TranslationJobProgress, 
  TranslationResult, 
  FileContent,
  LogEntry,
  GlossaryEntry,
} from '../types/dtos';

/**
 * 번역 스토어 상태 인터페이스
 */
interface TranslationState {
  // === 입력 파일 ===
  inputFiles: FileContent[];
  currentFileIndex: number;
  
  // === 번역 상태 ===
  isRunning: boolean;
  isPaused: boolean;
  progress: TranslationJobProgress | null;
  results: TranslationResult[];
  
  // === 용어집 ===
  glossaryEntries: GlossaryEntry[];
  
  // === 로그 ===
  logs: LogEntry[];
  
  // === 출력 ===
  translatedText: string;
  
  // === 파일 관련 액션 ===
  setInputFiles: (files: FileContent[]) => void;
  addInputFiles: (files: FileContent[]) => void;
  removeInputFile: (index: number) => void;
  clearInputFiles: () => void;
  setCurrentFileIndex: (index: number) => void;
  
  // === 번역 상태 액션 ===
  startTranslation: () => void;
  stopTranslation: () => void;
  pauseTranslation: () => void;
  resumeTranslation: () => void;
  updateProgress: (progress: TranslationJobProgress) => void;
  
  // === 결과 액션 ===
  addResult: (result: TranslationResult) => void;
  setResults: (results: TranslationResult[]) => void;
  updateResult: (chunkIndex: number, result: Partial<TranslationResult>) => void;
  clearResults: () => void;
  
  // === 용어집 액션 ===
  setGlossaryEntries: (entries: GlossaryEntry[]) => void;
  addGlossaryEntry: (entry: GlossaryEntry) => void;
  removeGlossaryEntry: (keyword: string) => void;
  updateGlossaryEntry: (keyword: string, updates: Partial<GlossaryEntry>) => void;
  clearGlossary: () => void;
  
  // === 로그 액션 ===
  addLog: (level: LogEntry['level'], message: string) => void;
  clearLogs: () => void;
  
  // === 출력 액션 ===
  setTranslatedText: (text: string) => void;
  combineResultsToText: () => void;
  
  // === 전체 리셋 ===
  reset: () => void;
}

/**
 * 초기 상태
 */
const initialState = {
  inputFiles: [],
  currentFileIndex: 0,
  isRunning: false,
  isPaused: false,
  progress: null,
  results: [],
  glossaryEntries: [],
  logs: [],
  translatedText: '',
};

/**
 * 번역 스토어
 */
export const useTranslationStore = create<TranslationState>((set, get) => ({
  // 초기 상태
  ...initialState,
  
  // === 파일 관련 액션 ===
  setInputFiles: (files) => set({ 
    inputFiles: files,
    currentFileIndex: 0,
  }),
  
  addInputFiles: (files) => set((state) => ({
    inputFiles: [...state.inputFiles, ...files],
  })),
  
  removeInputFile: (index) => set((state) => ({
    inputFiles: state.inputFiles.filter((_, i) => i !== index),
    currentFileIndex: Math.min(state.currentFileIndex, state.inputFiles.length - 2),
  })),
  
  clearInputFiles: () => set({ 
    inputFiles: [],
    currentFileIndex: 0,
  }),
  
  setCurrentFileIndex: (index) => set({ currentFileIndex: index }),
  
  // === 번역 상태 액션 ===
  startTranslation: () => {
    const { addLog } = get();
    addLog('info', '번역 작업을 시작합니다.');
    set({ 
      isRunning: true,
      isPaused: false,
      results: [],
      translatedText: '',
      progress: null,
    });
  },
  
  stopTranslation: () => {
    const { addLog } = get();
    addLog('warning', '번역 작업이 중단되었습니다.');
    set({ 
      isRunning: false,
      isPaused: false,
    });
  },
  
  pauseTranslation: () => {
    const { addLog } = get();
    addLog('info', '번역 작업이 일시 중지되었습니다.');
    set({ isPaused: true });
  },
  
  resumeTranslation: () => {
    const { addLog } = get();
    addLog('info', '번역 작업을 재개합니다.');
    set({ isPaused: false });
  },
  
  updateProgress: (progress) => set({ progress }),
  
  // === 결과 액션 ===
  addResult: (result) => set((state) => ({
    results: [...state.results, result],
  })),
  
  setResults: (results) => set({ results }),
  
  updateResult: (chunkIndex, updates) => set((state) => ({
    results: state.results.map((r) =>
      r.chunkIndex === chunkIndex ? { ...r, ...updates } : r
    ),
  })),
  
  clearResults: () => set({ 
    results: [],
    translatedText: '',
  }),
  
  // === 용어집 액션 ===
  setGlossaryEntries: (entries) => set({ glossaryEntries: entries }),
  
  addGlossaryEntry: (entry) => set((state) => {
    // 중복 키워드 체크
    const exists = state.glossaryEntries.some(
      (e) => e.keyword.toLowerCase() === entry.keyword.toLowerCase()
    );
    if (exists) {
      console.warn(`용어집에 이미 존재하는 키워드: ${entry.keyword}`);
      return state;
    }
    return { glossaryEntries: [...state.glossaryEntries, entry] };
  }),
  
  removeGlossaryEntry: (keyword) => set((state) => ({
    glossaryEntries: state.glossaryEntries.filter(
      (e) => e.keyword.toLowerCase() !== keyword.toLowerCase()
    ),
  })),
  
  updateGlossaryEntry: (keyword, updates) => set((state) => ({
    glossaryEntries: state.glossaryEntries.map((e) =>
      e.keyword.toLowerCase() === keyword.toLowerCase()
        ? { ...e, ...updates }
        : e
    ),
  })),
  
  clearGlossary: () => set({ glossaryEntries: [] }),
  
  // === 로그 액션 ===
  addLog: (level, message) => set((state) => ({
    logs: [
      ...state.logs,
      { level, message, timestamp: new Date() },
    ],
  })),
  
  clearLogs: () => set({ logs: [] }),
  
  // === 출력 액션 ===
  setTranslatedText: (text) => set({ translatedText: text }),
  
  combineResultsToText: () => set((state) => {
    const sortedResults = [...state.results].sort(
      (a, b) => a.chunkIndex - b.chunkIndex
    );
    const combinedText = sortedResults
      .map((r) => r.translatedText)
      .join('');
    return { translatedText: combinedText };
  }),
  
  // === 전체 리셋 ===
  reset: () => {
    set(initialState);
  },
}));

/**
 * 선택자 훅들 (성능 최적화)
 */
export const useInputFiles = () => useTranslationStore((state) => state.inputFiles);
export const useIsRunning = () => useTranslationStore((state) => state.isRunning);
export const useProgress = () => useTranslationStore((state) => state.progress);
export const useResults = () => useTranslationStore((state) => state.results);
export const useLogs = () => useTranslationStore((state) => state.logs);
export const useTranslatedText = () => useTranslationStore((state) => state.translatedText);
export const useGlossaryEntries = () => useTranslationStore((state) => state.glossaryEntries);

/**
 * 복합 선택자
 */
export const useTranslationStatus = () => useTranslationStore((state) => ({
  isRunning: state.isRunning,
  isPaused: state.isPaused,
  progress: state.progress,
}));

export const useTranslationStats = () => useTranslationStore((state) => ({
  totalFiles: state.inputFiles.length,
  currentFile: state.currentFileIndex + 1,
  totalChunks: state.progress?.totalChunks ?? 0,
  processedChunks: state.progress?.processedChunks ?? 0,
  successfulChunks: state.progress?.successfulChunks ?? 0,
  failedChunks: state.progress?.failedChunks ?? 0,
}));
