// components/common/FormElements.tsx
// 폼 입력 요소 컴포넌트들

import React, { forwardRef } from 'react';

/**
 * Input Props
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 라벨 */
  label?: string;
  /** 에러 메시지 */
  error?: string;
  /** 도움말 텍스트 */
  helperText?: string;
  /** 왼쪽 아이콘 */
  leftIcon?: React.ReactNode;
  /** 오른쪽 아이콘 */
  rightIcon?: React.ReactNode;
  /** 전체 너비 */
  fullWidth?: boolean;
}

/**
 * Input 컴포넌트
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  fullWidth = true,
  className = '',
  id,
  ...props
}, ref) => {
  const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label 
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full border rounded-lg px-3 py-2
            transition-colors duration-200
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500
            disabled:bg-gray-100 disabled:cursor-not-allowed
            ${error 
              ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
              : 'border-gray-300'
            }
            ${leftIcon ? 'pl-10' : ''}
            ${rightIcon ? 'pr-10' : ''}
            ${className}
          `}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {rightIcon}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  );
});

Input.displayName = 'Input';

/**
 * Select Props
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** 라벨 */
  label?: string;
  /** 에러 메시지 */
  error?: string;
  /** 도움말 텍스트 */
  helperText?: string;
  /** 옵션 목록 */
  options: { value: string; label: string; disabled?: boolean }[];
  /** 플레이스홀더 */
  placeholder?: string;
  /** 전체 너비 */
  fullWidth?: boolean;
}

/**
 * Select 컴포넌트
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  label,
  error,
  helperText,
  options,
  placeholder,
  fullWidth = true,
  className = '',
  id,
  ...props
}, ref) => {
  const selectId = id || `select-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label 
          htmlFor={selectId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={`
          w-full border rounded-lg px-3 py-2
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500
          disabled:bg-gray-100 disabled:cursor-not-allowed
          ${error 
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
            : 'border-gray-300'
          }
          ${className}
        `}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map(option => (
          <option 
            key={option.value} 
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  );
});

Select.displayName = 'Select';

/**
 * Textarea Props
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 라벨 */
  label?: string;
  /** 에러 메시지 */
  error?: string;
  /** 도움말 텍스트 */
  helperText?: string;
  /** 전체 너비 */
  fullWidth?: boolean;
  /** 자동 높이 조절 */
  autoResize?: boolean;
}

/**
 * Textarea 컴포넌트
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({
  label,
  error,
  helperText,
  fullWidth = true,
  autoResize = false,
  className = '',
  id,
  rows = 4,
  onChange,
  ...props
}, ref) => {
  const textareaId = id || `textarea-${Math.random().toString(36).slice(2, 9)}`;

  // 자동 높이 조절 핸들러
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (autoResize) {
      e.target.style.height = 'auto';
      e.target.style.height = `${e.target.scrollHeight}px`;
    }
    onChange?.(e);
  };

  return (
    <div className={`${fullWidth ? 'w-full' : ''}`}>
      {label && (
        <label 
          htmlFor={textareaId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        onChange={handleChange}
        className={`
          w-full border rounded-lg px-3 py-2
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500
          disabled:bg-gray-100 disabled:cursor-not-allowed
          ${autoResize ? 'resize-none overflow-hidden' : 'resize-y'}
          ${error 
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
            : 'border-gray-300'
          }
          ${className}
        `}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  );
});

Textarea.displayName = 'Textarea';

/**
 * Checkbox Props
 */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 라벨 (Optional) */
  label?: string;
  /** 설명 */
  description?: string;
}

/**
 * Checkbox 컴포넌트
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({
  label,
  description,
  className = '',
  id,
  ...props
}, ref) => {
  const checkboxId = id || `checkbox-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className="flex items-start">
      <input
        ref={ref}
        type="checkbox"
        id={checkboxId}
        className={`
          mt-1 h-4 w-4 rounded border-gray-300 
          text-primary-600 
          focus:ring-primary-500
          disabled:opacity-50
          ${className}
        `}
        {...props}
      />
      {(label || description) && (
        <div className="ml-2">
          {label && (
            <label 
              htmlFor={checkboxId}
              className="text-sm font-medium text-gray-700 cursor-pointer"
            >
              {label}
            </label>
          )}
          {description && (
            <p className="text-sm text-gray-500">{description}</p>
          )}
        </div>
      )}
    </div>
  );
});

Checkbox.displayName = 'Checkbox';

/**
 * Slider Props
 */
export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 라벨 */
  label?: string;
  /** 현재 값 표시 */
  showValue?: boolean;
  /** 값 포맷터 */
  formatValue?: (value: number) => string;
  /** 도움말 텍스트 */
  helperText?: string;
}

/**
 * Slider 컴포넌트
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(({
  label,
  showValue = true,
  formatValue = (v) => v.toString(),
  helperText,
  className = '',
  id,
  value,
  min = 0,
  max = 100,
  step = 1,
  ...props
}, ref) => {
  const sliderId = id || `slider-${Math.random().toString(36).slice(2, 9)}`;
  const currentValue = typeof value === 'number' ? value : Number(value) || 0;

  return (
    <div className="w-full">
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-1">
          {label && (
            <label 
              htmlFor={sliderId}
              className="text-sm font-medium text-gray-700"
            >
              {label}
            </label>
          )}
          {showValue && (
            <span className="text-sm font-mono text-gray-600">
              {formatValue(currentValue)}
            </span>
          )}
        </div>
      )}
      <input
        ref={ref}
        type="range"
        id={sliderId}
        value={value}
        min={min}
        max={max}
        step={step}
        className={`
          w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer
          accent-primary-600
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}
        `}
        {...props}
      />
      {helperText && (
        <p className="mt-1 text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  );
});

Slider.displayName = 'Slider';