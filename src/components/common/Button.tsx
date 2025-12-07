// components/common/Button.tsx
// 다양한 스타일의 버튼 컴포넌트

import React from 'react';

/**
 * 버튼 Props
 */
export interface ButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  /** 버튼 변형 */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
  /** 버튼 크기 */
  size?: 'sm' | 'md' | 'lg';
  /** 전체 너비 */
  fullWidth?: boolean;
  /** 로딩 상태 */
  loading?: boolean;
  /** 왼쪽 아이콘 */
  leftIcon?: React.ReactNode;
  /** 오른쪽 아이콘 */
  rightIcon?: React.ReactNode;
}

/**
 * 변형별 클래스
 */
const variantClasses = {
  primary: `
    bg-primary-600 text-white 
    hover:bg-primary-700 
    active:bg-primary-800
    disabled:bg-primary-300
  `,
  secondary: `
    bg-gray-600 text-white 
    hover:bg-gray-700 
    active:bg-gray-800
    disabled:bg-gray-300
  `,
  outline: `
    bg-transparent text-primary-600 border-2 border-primary-600
    hover:bg-primary-50 
    active:bg-primary-100
    disabled:border-primary-200 disabled:text-primary-300
  `,
  ghost: `
    bg-transparent text-gray-700 
    hover:bg-gray-100 
    active:bg-gray-200
    disabled:text-gray-300
  `,
  danger: `
    bg-red-600 text-white 
    hover:bg-red-700 
    active:bg-red-800
    disabled:bg-red-300
  `,
  success: `
    bg-green-600 text-white 
    hover:bg-green-700 
    active:bg-green-800
    disabled:bg-green-300
  `,
};

/**
 * 크기별 클래스
 */
const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

/**
 * 버튼 컴포넌트
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leftIcon,
  rightIcon,
  children,
  disabled,
  className = '',
  ...props
}) => {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center gap-2
        font-medium rounded-lg
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500
        disabled:cursor-not-allowed
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : leftIcon}
      
      {children}
      
      {!loading && rightIcon}
    </button>
  );
};

/**
 * 아이콘 버튼 Props
 */
export interface IconButtonProps extends Omit<React.ComponentPropsWithoutRef<'button'>, 'children'> {
  /** 아이콘 */
  icon: React.ReactNode;
  /** 버튼 변형 */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  /** 버튼 크기 */
  size?: 'sm' | 'md' | 'lg';
  /** 로딩 상태 */
  loading?: boolean;
  /** 접근성 라벨 */
  'aria-label': string;
}

/**
 * 아이콘 버튼 크기별 클래스
 */
const iconSizeClasses = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3',
};

/**
 * 아이콘 버튼 컴포넌트
 */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  ...props
}) => {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center
        rounded-lg
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500
        disabled:cursor-not-allowed
        ${variantClasses[variant]}
        ${iconSizeClasses[size]}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : icon}
    </button>
  );
};

/**
 * 버튼 그룹 Props
 */
export interface ButtonGroupProps {
  /** 자식 버튼들 */
  children: React.ReactNode;
  /** 정렬 */
  align?: 'left' | 'center' | 'right';
  /** 간격 */
  gap?: 'sm' | 'md' | 'lg';
  /** 커스텀 클래스 */
  className?: string;
}

const alignClasses = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

const gapClasses = {
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
};

/**
 * 버튼 그룹 컴포넌트
 */
export const ButtonGroup: React.FC<ButtonGroupProps> = ({
  children,
  align = 'left',
  gap = 'md',
  className = '',
}) => {
  return (
    <div className={`flex flex-wrap ${alignClasses[align]} ${gapClasses[gap]} ${className}`}>
      {children}
    </div>
  );
};

export default Button;