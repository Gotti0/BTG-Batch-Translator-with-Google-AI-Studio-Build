// components/common/ToastContainer.tsx
// 전역 토스트 알림 렌더러

import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore, type ToastType } from '../../stores/toastStore';

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />,
  info: <Info className="w-5 h-5 text-blue-600 shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
  error: <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />,
};

const borderClasses: Record<ToastType, string> = {
  success: 'border-emerald-200',
  info: 'border-blue-200',
  warning: 'border-amber-200',
  error: 'border-red-200',
};

export const ToastContainer: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2.5 max-w-lg w-[calc(100%-2rem)] pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`pointer-events-auto w-full flex items-start gap-3 p-4 rounded-xl border bg-white shadow-2xl ${borderClasses[t.type]}`}
        >
          {icons[t.type]}
          <div className="flex-1 min-w-0">
            {t.title && <h4 className="text-xs font-bold text-gray-900 mb-0.5">{t.title}</h4>}
            <p className="text-xs text-gray-700 leading-relaxed font-medium whitespace-pre-line">{t.message}</p>
          </div>
          <button
            type="button"
            onClick={() => removeToast(t.id)}
            className="text-gray-400 hover:text-gray-700 p-0.5 rounded transition-colors -mr-1 -mt-1"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
