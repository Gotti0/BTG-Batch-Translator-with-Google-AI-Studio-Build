// stores/settingsStore.ts
// 설정 상태 관리 (Zustand)

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig } from '../types/config';
import { defaultConfig } from '../types/config';

/**
 * 설정 스토어 상태 인터페이스
 */
interface SettingsState {
  // 상태
  config: AppConfig;
  isLoaded: boolean;
  
  // 액션
  updateConfig: (partial: Partial<AppConfig>) => void;
  resetConfig: () => void;
  setConfig: (config: AppConfig) => void;
  
  // 내보내기/가져오기
  exportConfig: () => string;
  importConfig: (json: string) => boolean;
}

/**
 * 설정 스토어
 * - LocalStorage에 자동 저장 (persist 미들웨어)
 * - 앱 설정을 전역적으로 관리
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // 초기 상태
      config: { ...defaultConfig },
      isLoaded: false,
      
      // 설정 부분 업데이트
      updateConfig: (partial) => set((state) => ({
        config: { ...state.config, ...partial },
      })),
      
      // 설정 초기화
      resetConfig: () => set({ 
        config: { ...defaultConfig },
      }),
      
      // 설정 전체 교체
      setConfig: (config) => set({ 
        config: { ...defaultConfig, ...config },
        isLoaded: true,
      }),
      
      // JSON으로 내보내기
      exportConfig: () => {
        const { config } = get();
        return JSON.stringify(config, null, 2);
      },
      
      // JSON에서 가져오기
      importConfig: (json) => {
        try {
          const imported = JSON.parse(json);
          set({ 
            config: { ...defaultConfig, ...imported },
            isLoaded: true,
          });
          return true;
        } catch (error) {
          console.error('설정 가져오기 실패:', error);
          return false;
        }
      },
    }),
    {
      name: 'btg-settings', // LocalStorage 키
      partialize: (state) => ({ config: state.config }), // config만 저장
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isLoaded = true;
        }
      },
    }
  )
);

/**
 * 설정 값 선택자 훅들 (성능 최적화)
 */
export const useModelName = () => useSettingsStore((state) => state.config.modelName);
export const useTemperature = () => useSettingsStore((state) => state.config.temperature);
export const useChunkSize = () => useSettingsStore((state) => state.config.chunkSize);
export const useRpm = () => useSettingsStore((state) => state.config.requestsPerMinute);
export const usePrompts = () => useSettingsStore((state) => state.config.prompts);
export const usePrefillEnabled = () => useSettingsStore((state) => state.config.enablePrefillTranslation);
export const useGlossaryInjectionEnabled = () => useSettingsStore((state) => state.config.enableDynamicGlossaryInjection);
