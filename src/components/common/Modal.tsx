// components/common/Modal.tsx
// 모달 다이얼로그 컴포넌트

import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

/**
 * 모달 Props
 */
export interface ModalProps {
  /** 모달 열림 상태 */
  isOpen: boolean;
  /** 닫기 콜백 */
  onClose: () => void;
  /** 제목 */
  title?: string;
  /** 자식 컴포넌트 (내용) */
  children: React.ReactNode;
  /** 푸터 (버튼 등) */
  footer?: React.ReactNode;
  /** 모달 크기 */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** 배경 클릭으로 닫기 허용 */
  closeOnBackdrop?: boolean;
  /** ESC 키로 닫기 허용 */
  closeOnEsc?: boolean;
  /** 닫기 버튼 표시 */
  showCloseButton?: boolean;
  /** 커스텀 클래스 */
  className?: string;
}

/**
 * 크기별 너비 클래스
 */
const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl',
};

/**
 * 모달 컴포넌트
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
  showCloseButton = true,
  className = '',
}) => {
  // ESC 키 핸들러
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (closeOnEsc && e.key === 'Escape') {
      onClose();
    }
  }, [closeOnEsc, onClose]);

  // ESC 키 이벤트 등록
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // 스크롤 방지
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  // 배경 클릭 핸들러
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  }, [closeOnBackdrop, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
      onClick={handleBackdropClick}
    >
      <div
        className={`
          bg-white rounded-lg shadow-xl w-full
          ${sizeClasses[size]} ${className}
          animate-scaleIn
        `}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            {title && (
              <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-gray-100 rounded-full transition-colors ml-auto"
                title="닫기"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            )}
          </div>
        )}

        {/* 본문 */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {children}
        </div>

        {/* 푸터 */}
        {footer && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 확인 다이얼로그 Props
 */
export interface ConfirmDialogProps {
  /** 다이얼로그 열림 상태 */
  isOpen: boolean;
  /** 닫기 콜백 */
  onClose: () => void;
  /** 확인 콜백 */
  onConfirm: () => void;
  /** 제목 */
  title: string;
  /** 메시지 */
  message: string | React.ReactNode;
  /** 확인 버튼 텍스트 */
  confirmText?: string;
  /** 취소 버튼 텍스트 */
  cancelText?: string;
  /** 위험 동작 여부 (빨간색 확인 버튼) */
  danger?: boolean;
  /** 로딩 상태 */
  loading?: boolean;
}

/**
 * 확인 다이얼로그
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '확인',
  cancelText = '취소',
  danger = false,
  loading = false,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`
              px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors
              ${danger 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-primary-600 hover:bg-primary-700'
              }
            `}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                처리 중...
              </span>
            ) : confirmText}
          </button>
        </div>
      }
    >
      <div className="text-gray-600">{message}</div>
    </Modal>
  );
};

/**
 * 알림 다이얼로그 Props
 */
export interface AlertDialogProps {
  /** 다이얼로그 열림 상태 */
  isOpen: boolean;
  /** 닫기 콜백 */
  onClose: () => void;
  /** 제목 */
  title: string;
  /** 메시지 */
  message: string | React.ReactNode;
  /** 버튼 텍스트 */
  buttonText?: string;
  /** 타입 (아이콘/색상) */
  type?: 'info' | 'success' | 'warning' | 'error';
}

/**
 * 알림 다이얼로그
 */
export const AlertDialog: React.FC<AlertDialogProps> = ({
  isOpen,
  onClose,
  title,
  message,
  buttonText = '확인',
  type = 'info',
}) => {
  const iconMap = {
    info: '💬',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${iconMap[type]} ${title}`}
      size="sm"
      footer={
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            {buttonText}
          </button>
        </div>
      }
    >
      <div className="text-gray-600">{message}</div>
    </Modal>
  );
};

export default Modal;