// components/common/FileUpload.tsx
// 드래그앤드롭 + 클릭 파일 업로드 컴포넌트

import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, File, AlertCircle } from 'lucide-react';

/**
 * 파일 표시용 인터페이스
 */
export interface FileDisplayItem {
  name: string;
  size: number;
}

/**
 * 파일 업로드 컴포넌트 Props
 */
export interface FileUploadProps {
  /** 허용할 파일 확장자 (예: ['.txt', '.json']) */
  accept?: string[];
  /** 다중 파일 선택 허용 여부 */
  multiple?: boolean;
  /** 최대 파일 크기 (바이트 단위) */
  maxSize?: number;
  /** 파일 선택 시 콜백 */
  onFilesSelected: (files: File[]) => void;
  /** 선택된 파일 목록 (외부 상태) - File 객체 또는 FileDisplayItem 호환 객체 */
  selectedFiles?: FileDisplayItem[];
  /** 파일 제거 콜백 */
  onFileRemove?: (index: number) => void;
  /** 비활성화 여부 */
  disabled?: boolean;
  /** 드롭존 높이 */
  height?: string;
  /** 커스텀 클래스 */
  className?: string;
}

/**
 * 파일 크기를 읽기 좋은 형식으로 변환
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * 파일 업로드 컴포넌트
 */
export function FileUpload({
  accept = ['.txt'],
  multiple = true,
  maxSize = 10 * 1024 * 1024, // 10MB
  onFilesSelected,
  selectedFiles = [],
  onFileRemove,
  disabled = false,
  height = 'h-40',
  className = '',
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 파일 유효성 검사
  const validateFiles = useCallback((files: FileList | File[]): File[] => {
    const validFiles: File[] = [];
    const errors: string[] = [];

    Array.from(files).forEach(file => {
      // 확장자 검사
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
      if (accept.length > 0 && !accept.includes(ext)) {
        errors.push(`${file.name}: 지원하지 않는 형식입니다.`);
        return;
      }

      // 파일 크기 검사
      if (file.size > maxSize) {
        errors.push(`${file.name}: 파일 크기가 ${formatFileSize(maxSize)}를 초과합니다.`);
        return;
      }

      validFiles.push(file);
    });

    if (errors.length > 0) {
      setError(errors.join('\n'));
      setTimeout(() => setError(null), 5000);
    }

    return validFiles;
  }, [accept, maxSize]);

  // 드래그 이벤트 핸들러
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const validFiles = validateFiles(files);
      if (validFiles.length > 0) {
        onFilesSelected(multiple ? validFiles : [validFiles[0]]);
      }
    }
  }, [disabled, multiple, validateFiles, onFilesSelected]);

  // 클릭으로 파일 선택
  const handleClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  // 파일 input 변경 핸들러
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const validFiles = validateFiles(files);
      if (validFiles.length > 0) {
        onFilesSelected(multiple ? validFiles : [validFiles[0]]);
      }
    }
    // input 리셋 (같은 파일 재선택 가능하도록)
    e.target.value = '';
  }, [multiple, validateFiles, onFilesSelected]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 드롭존 */}
      <div
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          ${height} border-2 border-dashed rounded-lg
          flex flex-col items-center justify-center
          transition-all cursor-pointer
          ${disabled 
            ? 'bg-gray-100 border-gray-200 cursor-not-allowed' 
            : isDragging
              ? 'bg-primary-50 border-primary-500 scale-[1.02]'
              : 'bg-white border-gray-300 hover:border-primary-500 hover:bg-primary-50'
          }
        `}
      >
        <Upload className={`w-10 h-10 mb-3 ${isDragging ? 'text-primary-500' : 'text-gray-400'}`} />
        <p className={`text-sm font-medium ${isDragging ? 'text-primary-600' : 'text-gray-600'}`}>
          {isDragging ? '여기에 놓으세요!' : '파일을 드래그하거나 클릭하여 선택'}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          지원 형식: {accept.join(', ')} | 최대 {formatFileSize(maxSize)}
        </p>
      </div>

      {/* 숨겨진 파일 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept.join(',')}
        multiple={multiple}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 에러 메시지 */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <pre className="whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {/* 선택된 파일 목록 */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            선택된 파일 ({selectedFiles.length}개)
          </p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {selectedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <File className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{file.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    ({formatFileSize(file.size)})
                  </span>
                </div>
                {onFileRemove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileRemove(index);
                    }}
                    className="p-1 hover:bg-red-100 rounded-full transition-colors"
                    title="파일 제거"
                  >
                    <X className="w-4 h-4 text-red-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUpload;