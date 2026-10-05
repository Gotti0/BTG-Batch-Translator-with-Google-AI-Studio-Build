// utils/downloadUtils.ts
// 파일 다운로드와 출력 파일명 계산

import { useProjectStore } from '../stores/projectStore';
import { resolveOutputFileName } from '../types/project';
import type { FileContent } from '../types/dtos';

/**
 * Blob을 파일로 내려받게 한다
 */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 일부 브라우저는 click 직후 URL을 해제하면 다운로드가 취소된다
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 프로젝트의 출력 파일명 패턴으로 확장자 없는 파일명을 만든다.
 * 패턴 결과가 비면 첫 입력 파일명을 쓴다.
 */
export function getOutputBaseName(inputFiles: FileContent[] = []): string {
  const project = useProjectStore.getState().project;
  const fallback = inputFiles[0]?.name?.replace(/\.[^/.]+$/, '') || project.title || 'translated_output';
  return resolveOutputFileName(project.outputFileNamePattern, project, fallback);
}
