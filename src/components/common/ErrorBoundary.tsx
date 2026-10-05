// components/common/ErrorBoundary.tsx
// 렌더링 예외로 화면 전체가 하얗게 비는 것을 막는 전역 에러 바운더리

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';
import { Button } from './Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary가 처리하지 못한 오류를 잡았습니다:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-red-100 p-6 text-center space-y-4">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
            <AlertOctagon className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-gray-900">화면을 그리는 중 오류가 발생했습니다</h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              다시 시도하거나 페이지를 새로고침해 주세요. 새로고침하면 저장되지 않은 작업은 스냅샷 탭에서 복원할 수 있습니다.
            </p>
          </div>
          {this.state.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-left text-xs text-red-800 font-mono overflow-auto max-h-40 break-words">
              {this.state.error.message || String(this.state.error)}
            </div>
          )}
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={this.handleReset}>
              다시 시도
            </Button>
            <Button variant="danger" size="sm" onClick={this.handleReload} leftIcon={<RotateCcw className="w-4 h-4" />}>
              페이지 새로고침
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
