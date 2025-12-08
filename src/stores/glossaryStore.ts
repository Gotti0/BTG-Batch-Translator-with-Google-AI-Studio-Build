// stores/glossaryStore.ts
// 용어집 추출 및 관리 상태 (Zustand)

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GlossaryEntry, GlossaryExtractionProgress } from '../types/dtos';

/**
 * 용어집 스토어 상태 인터페이스
 */
interface GlossaryState {
  // === 용어집 데이터 ===
  entries: GlossaryEntry[];
  
  // === 추출 상태 ===
  isExtracting: boolean;
  extractionProgress: GlossaryExtractionProgress | null;
  
  // === 편집 상태 ===
  selectedEntries: Set<string>; // keyword 기준
  editingEntry: GlossaryEntry | null;
  searchQuery: string;
  sortBy: 'keyword' | 'translatedKeyword' | 'occurrenceCount';
  sortOrder: 'asc' | 'desc';
  
  // === 용어집 데이터 액션 ===
  setEntries: (entries: GlossaryEntry[]) => void;
  addEntry: (entry: GlossaryEntry) => void;
  addEntries: (entries: GlossaryEntry[]) => void;
  updateEntry: (keyword: string, updates: Partial<GlossaryEntry>) => void;
  removeEntry: (keyword: string) => void;
  removeEntries: (keywords: string[]) => void;
  clearEntries: () => void;
  
  // === 중복 병합 ===
  mergeEntries: (entries: GlossaryEntry[]) => void;
  
  // === 추출 상태 액션 ===
  startExtraction: () => void;
  stopExtraction: () => void;
  updateExtractionProgress: (progress: GlossaryExtractionProgress) => void;
  
  // === 선택 액션 ===
  selectEntry: (keyword: string) => void;
  deselectEntry: (keyword: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  toggleSelection: (keyword: string) => void;
  
  // === 편집 액션 ===
  setEditingEntry: (entry: GlossaryEntry | null) => void;
  
  // === 검색/정렬 ===
  setSearchQuery: (query: string) => void;
  setSortBy: (sortBy: GlossaryState['sortBy']) => void;
  setSortOrder: (order: GlossaryState['sortOrder']) => void;
  
  // === 내보내기/가져오기 ===
  exportToJson: () => string;
  importFromJson: (json: string) => boolean;
  
  // === 필터링된 항목 가져오기 ===
  getFilteredEntries: () => GlossaryEntry[];
}

/**
 * 초기 상태
 */
const initialState = {
  entries: [],
  isExtracting: false,
  extractionProgress: null,
  selectedEntries: new Set<string>(),
  editingEntry: null,
  searchQuery: '',
  sortBy: 'occurrenceCount' as const,
  sortOrder: 'desc' as const,
};

/**
 * 용어집 스토어
 */
export const useGlossaryStore = create<GlossaryState>()(
  persist(
    (set, get) => ({
      // 초기 상태
      ...initialState,
      
      // === 용어집 데이터 액션 ===
      setEntries: (entries) => set({ entries }),
      
      addEntry: (entry) => set((state) => {
        // 중복 체크
        const exists = state.entries.some(
          (e) => e.keyword.toLowerCase() === entry.keyword.toLowerCase()
        );
        if (exists) {
          console.warn(`이미 존재하는 키워드: ${entry.keyword}`);
          return state;
        }
        return { entries: [...state.entries, entry] };
      }),
      
      addEntries: (newEntries) => set((state) => {
        const existingKeywords = new Set(
          state.entries.map((e) => e.keyword.toLowerCase())
        );
        const uniqueEntries = newEntries.filter(
          (e) => !existingKeywords.has(e.keyword.toLowerCase())
        );
        return { entries: [...state.entries, ...uniqueEntries] };
      }),
      
      updateEntry: (keyword, updates) => set((state) => ({
        entries: state.entries.map((e) =>
          e.keyword.toLowerCase() === keyword.toLowerCase()
            ? { ...e, ...updates }
            : e
        ),
      })),
      
      removeEntry: (keyword) => set((state) => ({
        entries: state.entries.filter(
          (e) => e.keyword.toLowerCase() !== keyword.toLowerCase()
        ),
        selectedEntries: (() => {
          const newSet = new Set(state.selectedEntries);
          newSet.delete(keyword.toLowerCase());
          return newSet;
        })(),
      })),
      
      removeEntries: (keywords) => set((state) => {
        const keywordsLower = new Set(keywords.map((k) => k.toLowerCase()));
        return {
          entries: state.entries.filter(
            (e) => !keywordsLower.has(e.keyword.toLowerCase())
          ),
          selectedEntries: new Set(
            [...state.selectedEntries].filter((k) => !keywordsLower.has(k))
          ),
        };
      }),
      
      clearEntries: () => set({ 
        entries: [],
        selectedEntries: new Set(),
      }),
      
      // === 중복 병합 ===
      mergeEntries: (newEntries) => set((state) => {
        const entryMap = new Map<string, GlossaryEntry>();
        
        // 기존 항목 추가
        for (const entry of state.entries) {
          entryMap.set(entry.keyword.toLowerCase(), entry);
        }
        
        // 새 항목 병합 (등장 횟수 합산)
        for (const entry of newEntries) {
          const key = entry.keyword.toLowerCase();
          const existing = entryMap.get(key);
          
          if (existing) {
            entryMap.set(key, {
              ...existing,
              occurrenceCount: existing.occurrenceCount + entry.occurrenceCount,
            });
          } else {
            entryMap.set(key, entry);
          }
        }
        
        return { entries: Array.from(entryMap.values()) };
      }),
      
      // === 추출 상태 액션 ===
      startExtraction: () => set({ 
        isExtracting: true,
        extractionProgress: null,
      }),
      
      stopExtraction: () => set({ isExtracting: false }),
      
      updateExtractionProgress: (progress) => set({ extractionProgress: progress }),
      
      // === 선택 액션 ===
      selectEntry: (keyword) => set((state) => ({
        selectedEntries: new Set([...state.selectedEntries, keyword.toLowerCase()]),
      })),
      
      deselectEntry: (keyword) => set((state) => {
        const newSet = new Set(state.selectedEntries);
        newSet.delete(keyword.toLowerCase());
        return { selectedEntries: newSet };
      }),
      
      selectAll: () => set((state) => ({
        selectedEntries: new Set(state.entries.map((e) => e.keyword.toLowerCase())),
      })),
      
      deselectAll: () => set({ selectedEntries: new Set() }),
      
      toggleSelection: (keyword) => set((state) => {
        const key = keyword.toLowerCase();
        const newSet = new Set(state.selectedEntries);
        if (newSet.has(key)) {
          newSet.delete(key);
        } else {
          newSet.add(key);
        }
        return { selectedEntries: newSet };
      }),
      
      // === 편집 액션 ===
      setEditingEntry: (entry) => set({ editingEntry: entry }),
      
      // === 검색/정렬 ===
      setSearchQuery: (query) => set({ searchQuery: query }),
      setSortBy: (sortBy) => set({ sortBy }),
      setSortOrder: (order) => set({ sortOrder: order }),
      
      // === 내보내기/가져오기 ===
      exportToJson: () => {
        const { entries } = get();
        // exportToJson 로직은 GlossaryService에서 처리하거나, 여기서 동일하게 구현
        // 일관성을 위해 여기서는 단순 JSON 문자열화만 수행하거나,
        // 서비스와 동일한 변환 로직을 사용해야 함.
        // 하지만 요구사항은 GlossaryService 수정이었으므로, 스토어의 exportToJson은
        // 단순히 내부 상태를 내보내는 용도로 둘 수도 있으나,
        // 사용자가 다운로드할 때 일관된 포맷을 원하므로 여기서도 변환 적용
        const exportData = entries.map(entry => ({
          keyword: entry.keyword,
          translated_keyword: entry.translatedKeyword,
          target_language: entry.targetLanguage,
          occurrence_count: entry.occurrenceCount,
        }));
        return JSON.stringify(exportData, null, 2);
      },
      
      importFromJson: (json) => {
        try {
          const parsed = JSON.parse(json);
          if (!Array.isArray(parsed)) {
            console.error('유효하지 않은 용어집 형식: 배열이 아님');
            return false;
          }
          
          const validEntries: GlossaryEntry[] = [];
          for (const item of parsed) {
            if (
              typeof item === 'object' &&
              item !== null &&
              typeof item.keyword === 'string'
            ) {
              // Snake Case 데이터를 읽어서 Camel Case로 변환 (기존 호환성 유지)
              const translatedKeyword = item.translated_keyword || item.translatedKeyword;
              const targetLanguage = item.target_language || item.targetLanguage || 'ko';
              const occurrenceCount = item.occurrence_count || item.occurrenceCount || 0;

              if (typeof translatedKeyword === 'string') {
                validEntries.push({
                  keyword: item.keyword,
                  translatedKeyword: translatedKeyword,
                  targetLanguage: targetLanguage,
                  occurrenceCount: occurrenceCount,
                  // 메타데이터 생성
                  id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
              }
            }
          }
          
          if (validEntries.length > 0) {
            const { mergeEntries } = get();
            mergeEntries(validEntries);
          }
          return false;
        } catch (error) {
          console.error('용어집 가져오기 실패:', error);
          return false;
        }
      },
      
      // === 필터링된 항목 가져오기 ===
      getFilteredEntries: () => {
        const { entries, searchQuery, sortBy, sortOrder } = get();
        
        // 검색 필터링
        let filtered = entries;
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          filtered = entries.filter(
            (e) =>
              e.keyword.toLowerCase().includes(query) ||
              e.translatedKeyword.toLowerCase().includes(query)
          );
        }
        
        // 정렬
        const sorted = [...filtered].sort((a, b) => {
          let comparison = 0;
          
          switch (sortBy) {
            case 'keyword':
              comparison = a.keyword.localeCompare(b.keyword);
              break;
            case 'translatedKeyword':
              comparison = a.translatedKeyword.localeCompare(b.translatedKeyword);
              break;
            case 'occurrenceCount':
              comparison = a.occurrenceCount - b.occurrenceCount;
              break;
          }
          
          return sortOrder === 'asc' ? comparison : -comparison;
        });
        
        return sorted;
      },
    }),
    {
      name: 'btg-glossary', // LocalStorage 키
      partialize: (state) => ({ entries: state.entries }), // entries만 저장
    }
  )
);

/**
 * 선택자 훅들
 */
export const useGlossaryEntries = () => useGlossaryStore((state) => state.entries);
export const useIsExtracting = () => useGlossaryStore((state) => state.isExtracting);
export const useExtractionProgress = () => useGlossaryStore((state) => state.extractionProgress);
export const useSelectedEntries = () => useGlossaryStore((state) => state.selectedEntries);
export const useGlossarySearchQuery = () => useGlossaryStore((state) => state.searchQuery);

/**
 * 용어집 통계
 */
export const useGlossaryStats = () => useGlossaryStore((state) => ({
  totalEntries: state.entries.length,
  selectedCount: state.selectedEntries.size,
  totalOccurrences: state.entries.reduce((sum, e) => sum + e.occurrenceCount, 0),
}));