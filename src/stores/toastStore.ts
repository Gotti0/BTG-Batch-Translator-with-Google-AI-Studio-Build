// stores/toastStore.ts
// 전역 토스트 알림 상태 관리 (Zustand)
// 토스트로 띄운 알림은 실행 로그에도 같은 레벨로 함께 남깁니다.

import { create } from 'zustand';
import { useTranslationStore } from './translationStore';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (type: ToastType, message: string, title?: string, duration?: number) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const DEFAULT_DURATION_MS = 3500;

const LOG_PREFIX: Record<ToastType, string> = {
  success: '✅ ',
  info: 'ℹ️ ',
  warning: '⚠️ ',
  error: '🚨 ',
};

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  showToast: (type, message, title, duration = DEFAULT_DURATION_MS) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { id, type, title, message, duration }] }));

    // 토스트만 보고 지나치면 기록이 남지 않으므로 실행 로그에도 같은 내용을 남긴다
    const level = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
    const titlePart = title ? `[${title}] ` : '';
    useTranslationStore.getState().addLog(level, `${LOG_PREFIX[type]}${titlePart}${message}`);

    if (duration > 0) {
      setTimeout(() => get().removeToast(id), duration);
    }
    return id;
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  clearToasts: () => set({ toasts: [] }),
}));

/**
 * 컴포넌트 밖에서도 호출할 수 있는 토스트 헬퍼
 */
export const toast = {
  success: (message: string, title?: string, duration?: number) =>
    useToastStore.getState().showToast('success', message, title, duration),
  info: (message: string, title?: string, duration?: number) =>
    useToastStore.getState().showToast('info', message, title, duration),
  warning: (message: string, title?: string, duration?: number) =>
    useToastStore.getState().showToast('warning', message, title, duration),
  error: (message: string, title?: string, duration?: number) =>
    useToastStore.getState().showToast('error', message, title, duration),
};
