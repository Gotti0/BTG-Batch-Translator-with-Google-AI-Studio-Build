// components/common/ProgressBar.tsx
// 진행률 표시 바 컴포넌트

import React from 'react';

/**
 * 진행률 바 Props
 */
export interface ProgressBarProps {
  /** 진행률 (0-100) */
  value: number;
  /** 최대값 (기본: 100) */
  max?: number;
  /** 라벨 텍스트 */
  label?: string;
  /** 진행률 수치 표시 여부 */
  showPercentage?: boolean;
  /** 상세 정보 (예: "3/10 완료") */
  detail?: string;
  /** 바 높이 */
  height?: 'sm' | 'md' | 'lg';
  /** 색상 테마 */
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  /** 스트라이프 애니메이션 */
  striped?: boolean;
  /** 애니메이션 (스트라이프 이동) */
  animated?: boolean;
  /** 커스텀 클래스 */
  className?: string;
}

/**
 * 높이 클래스 맵
 */
const heightClasses = {
  sm: 'h-2',
  md: 'h-4',
  lg: 'h-6',
};

/**
 * 색상 클래스 맵
 */
const colorClasses = {
  primary: 'bg-primary-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  danger: 'bg-red-500',
  info: 'bg-blue-400',
};

/**
 * 진행률 바 컴포넌트
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  showPercentage = true,
  detail,
  height = 'md',
  color = 'primary',
  striped = false,
  animated = false,
  className = '',
}: ProgressBarProps) {
  // 퍼센트 계산 (0-100 범위 내로 제한)
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`space-y-1 ${className}`}>
      {/* 라벨 및 퍼센트 표시 */}
      {(label || showPercentage || detail) && (
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">{label}</span>
          <div className="flex items-center gap-2 text-gray-500">
            {detail && <span>{detail}</span>}
            {showPercentage && (
              <span className="font-mono">{percentage.toFixed(0)}%</span>
            )}
          </div>
        </div>
      )}

      {/* 프로그레스 바 */}
      <div 
        className={`
          w-full bg-gray-200 rounded-full overflow-hidden
          ${heightClasses[height]}
        `}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={`
            ${heightClasses[height]} ${colorClasses[color]}
            rounded-full transition-all duration-300 ease-out
            ${striped || animated ? 'bg-stripes' : ''}
            ${animated ? 'animate-stripes' : ''}
          `}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * 다중 진행률 바 (세그먼트)
 */
export interface SegmentedProgressBarProps {
  /** 세그먼트 배열 */
  segments: {
    value: number;
    color: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'gray';
    label?: string;
  }[];
  /** 총합 (기본: 세그먼트 값의 합) */
  total?: number;
  /** 바 높이 */
  height?: 'sm' | 'md' | 'lg';
  /** 범례 표시 */
  showLegend?: boolean;
  /** 커스텀 클래스 */
  className?: string;
}

const segmentColorClasses = {
  primary: 'bg-primary-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  danger: 'bg-red-500',
  info: 'bg-blue-400',
  gray: 'bg-gray-400',
};

/**
 * 세그먼트 진행률 바 (예: 성공/실패/대기 상태 표시)
 */
export function SegmentedProgressBar({
  segments,
  total,
  height = 'md',
  showLegend = false,
  className = '',
}: SegmentedProgressBarProps) {
  const computedTotal = total ?? segments.reduce((sum, seg) => sum + seg.value, 0);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* 프로그레스 바 */}
      <div 
        className={`
          w-full bg-gray-200 rounded-full overflow-hidden flex
          ${heightClasses[height]}
        `}
      >
        {segments.map((segment, index) => {
          const percentage = computedTotal > 0 
            ? (segment.value / computedTotal) * 100 
            : 0;
          
          if (percentage <= 0) return null;

          return (
            <div
              key={index}
              className={`
                ${heightClasses[height]} ${segmentColorClasses[segment.color]}
                transition-all duration-300 ease-out
                ${index === 0 ? 'rounded-l-full' : ''}
                ${index === segments.length - 1 ? 'rounded-r-full' : ''}
              `}
              style={{ width: `${percentage}%` }}
              title={segment.label ? `${segment.label}: ${segment.value}` : undefined}
            />
          );
        })}
      </div>

      {/* 범례 */}
      {showLegend && (
        <div className="flex flex-wrap gap-4 text-sm">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-full ${segmentColorClasses[segment.color]}`} />
              <span className="text-gray-600">
                {segment.label}: {segment.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 무한 로딩 진행률 바
 */
export interface IndeterminateProgressBarProps {
  /** 라벨 텍스트 */
  label?: string;
  /** 바 높이 */
  height?: 'sm' | 'md' | 'lg';
  /** 색상 테마 */
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  /** 커스텀 클래스 */
  className?: string;
}

/**
 * 무한 로딩 진행률 바 (알 수 없는 진행률)
 */
export function IndeterminateProgressBar({
  label,
  height = 'md',
  color = 'primary',
  className = '',
}: IndeterminateProgressBarProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <span className="text-sm font-medium text-gray-700">{label}</span>
      )}
      <div 
        className={`
          w-full bg-gray-200 rounded-full overflow-hidden relative
          ${heightClasses[height]}
        `}
      >
        <div
          className={`
            ${heightClasses[height]} ${colorClasses[color]}
            absolute rounded-full animate-indeterminate
          `}
          style={{ width: '30%' }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
