// pages/SnapshotPage.tsx
// 스냅샷 보관함: 자동·수동 스냅샷 목록, 복원, ZIP 내보내기·가져오기, 삭제

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { History, Save, Upload, Download, Trash2, RotateCcw, BookOpen, FileText, Image as ImageIcon } from 'lucide-react';
import { Button, ConfirmDialog } from '../components';
import { SnapshotService } from '../services/SnapshotService';
import { SnapshotStorage, DEFAULT_AUTO_SNAPSHOT_LIMIT } from '../services/SnapshotStorage';
import { useTranslationStore } from '../stores/translationStore';
import { toast } from '../stores/toastStore';
import type { SnapshotMeta } from '../types/snapshot';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface SnapshotPageProps {
  isActive: boolean;
  /** 복원이 끝나면 호출 (번역 탭으로 이동) */
  onRestored?: () => void;
}

export function SnapshotPage({ isActive, onRestored }: SnapshotPageProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [autoLimit, setAutoLimit] = useState(SnapshotStorage.getAutoSnapshotLimit());
  const [restoreTarget, setRestoreTarget] = useState<SnapshotMeta | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<SnapshotMeta[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isRunning = useTranslationStore((state) => state.isRunning);

  const refresh = useCallback(async () => {
    if (!SnapshotStorage.isAvailable()) return;
    setIsLoading(true);
    try {
      const list = await SnapshotStorage.listSnapshots();
      setSnapshots(list);
      setSelectedIds((prev) => new Set([...prev].filter((id) => list.some((s) => s.id === id))));
    } catch (e) {
      toast.error(`스냅샷 목록을 불러오지 못했습니다: ${e}`, '스냅샷');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) refresh();
  }, [isActive, refresh]);

  useEffect(() => {
    const handler = () => {
      if (isActive) refresh();
    };
    window.addEventListener('btg-snapshots-changed', handler);
    return () => window.removeEventListener('btg-snapshots-changed', handler);
  }, [isActive, refresh]);

  const handleSaveManual = async () => {
    setIsSaving(true);
    try {
      const meta = await SnapshotService.saveManualSnapshot();
      toast.success(`"${meta.projectTitle}" 스냅샷을 저장했습니다.`, '스냅샷 저장');
      await refresh();
    } catch (e) {
      toast.error(`스냅샷 저장 실패: ${e instanceof Error ? e.message : String(e)}`, '스냅샷 저장');
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const meta = await SnapshotService.importFileToArchive(file);
      toast.success(`"${meta.projectTitle}"을(를) 보관함에 추가했습니다. 복원 버튼으로 불러올 수 있습니다.`, '스냅샷 가져오기');
      await refresh();
    } catch (err) {
      toast.error(`가져오기 실패: ${err instanceof Error ? err.message : String(err)}`, '스냅샷 가져오기');
    }
  };

  const handleRestore = async (meta: SnapshotMeta) => {
    setRestoreTarget(null);
    setBusyId(meta.id);
    try {
      const result = await SnapshotService.restoreSnapshotById(meta.id);
      if (!result) {
        toast.error('스냅샷을 찾을 수 없습니다.', '스냅샷 복원');
        return;
      }
      toast.success(`"${meta.projectTitle}" 작업을 복원했습니다.`, '스냅샷 복원');
      onRestored?.();
    } catch (e) {
      toast.error(`복원 실패: ${e instanceof Error ? e.message : String(e)}`, '스냅샷 복원');
    } finally {
      setBusyId(null);
      await refresh();
    }
  };

  const handleExport = async (meta: SnapshotMeta) => {
    setBusyId(meta.id);
    try {
      const fileName = await SnapshotService.exportStoredSnapshotAsZip(meta.id);
      if (fileName) toast.success(`${fileName} 파일을 내려받았습니다.`, 'ZIP 내보내기');
    } catch (e) {
      toast.error(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`, 'ZIP 내보내기');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (targets: SnapshotMeta[]) => {
    setDeleteTargets(null);
    try {
      await SnapshotStorage.deleteSnapshots(targets.map((t) => t.id));
      toast.info(`스냅샷 ${targets.length}개를 삭제했습니다.`, '스냅샷 삭제');
      setSelectedIds(new Set());
      await refresh();
    } catch (e) {
      toast.error(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`, '스냅샷 삭제');
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedSnapshots = snapshots.filter((s) => selectedIds.has(s.id));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
              <History className="w-5 h-5" />
              스냅샷 보관함
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              설정·용어집·원문·번역 결과를 통째로 보관합니다. 작업 내용이 바뀌면 자동 스냅샷이 몇 초 안에 갱신되고,
              번역을 시작할 때마다 새 자동 스냅샷이 만들어집니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button variant="primary" size="sm" leftIcon={<Save className="w-4 h-4" />} onClick={handleSaveManual} loading={isSaving}>
              현재 작업 저장
            </Button>
            <Button variant="outline" size="sm" leftIcon={<Upload className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()}>
              파일 가져오기
            </Button>
            <input ref={fileInputRef} type="file" accept=".zip,.json" className="hidden" onChange={handleImportFile} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 pt-3 border-t">
          <label className="flex items-center gap-2">
            프로젝트별 자동 스냅샷 보관 개수
            <input
              type="number"
              min={1}
              max={50}
              value={autoLimit}
              onChange={(e) => {
                const value = Math.max(1, parseInt(e.target.value, 10) || DEFAULT_AUTO_SNAPSHOT_LIMIT);
                setAutoLimit(value);
                SnapshotStorage.setAutoSnapshotLimit(value);
              }}
              className="w-20 border rounded px-2 py-1"
            />
          </label>
          <span className="text-xs text-gray-400">넘으면 오래된 자동 스냅샷부터 지웁니다. 수동 스냅샷은 지우지 않습니다.</span>
          {selectedSnapshots.length > 0 && (
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              leftIcon={<Trash2 className="w-4 h-4" />}
              onClick={() => setDeleteTargets(selectedSnapshots)}
            >
              선택한 {selectedSnapshots.length}개 삭제
            </Button>
          )}
        </div>
      </div>

      {!SnapshotStorage.isAvailable() ? (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500">
          이 브라우저는 IndexedDB를 지원하지 않아 스냅샷을 쓸 수 없습니다.
        </div>
      ) : snapshots.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500">
          {isLoading ? '불러오는 중...' : '저장된 스냅샷이 없습니다. 파일을 올리거나 번역을 시작하면 자동으로 생깁니다.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {snapshots.map((meta) => {
            const percent = meta.totalChunks > 0 ? Math.round((meta.successfulChunks / meta.totalChunks) * 100) : 0;
            const isBusy = busyId === meta.id;
            return (
              <div
                key={meta.id}
                className={`bg-white rounded-lg shadow border p-4 space-y-3 ${selectedIds.has(meta.id) ? 'border-primary-400' : 'border-transparent'}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(meta.id)}
                    onChange={() => toggleSelection(meta.id)}
                    className="mt-1 h-4 w-4"
                    aria-label="선택"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                          meta.type === 'manual' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {meta.type === 'manual' ? '수동' : '자동'}
                      </span>
                      {meta.label && <span className="text-[11px] text-gray-500 truncate">{meta.label}</span>}
                    </div>
                    <h3 className="font-semibold text-gray-900 mt-1 truncate" title={meta.projectTitle}>
                      {meta.projectTitle}
                      {meta.episodeRange && <span className="text-gray-500 font-normal"> · {meta.episodeRange}</span>}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(meta.updatedAt).toLocaleString()} 저장
                      {meta.updateCount > 1 && ` (갱신 ${meta.updateCount}회)`}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                  <span className="flex items-center gap-1 truncate" title={meta.fileName}>
                    {meta.mode === 'epub' ? <BookOpen className="w-3.5 h-3.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}
                    {meta.fileName || '파일 없음'}
                  </span>
                  <span>
                    {meta.mode === 'epub' ? 'EPUB' : meta.translationMode === 'integrity' ? '텍스트 · 무결성' : '텍스트 · 기본'}
                  </span>
                  <span>원문 {meta.totalChars.toLocaleString()}자</span>
                  <span>약 {formatBytes(meta.approxBytes)}</span>
                  <span className="truncate" title={meta.modelName}>{meta.modelName}</span>
                  {meta.hasCover && (
                    <span className="flex items-center gap-1">
                      <ImageIcon className="w-3.5 h-3.5" />
                      표지 있음
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>
                      청크 {meta.successfulChunks}/{meta.totalChunks} 완료
                      {meta.failedChunks > 0 && <span className="text-red-500"> · 실패 {meta.failedChunks}</span>}
                    </span>
                    <span>{percent}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500" style={{ width: `${percent}%` }} />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<RotateCcw className="w-4 h-4" />}
                    onClick={() => setRestoreTarget(meta)}
                    disabled={isBusy || isRunning}
                    title={isRunning ? '번역 중에는 복원할 수 없습니다.' : undefined}
                  >
                    복원
                  </Button>
                  <Button variant="outline" size="sm" leftIcon={<Download className="w-4 h-4" />} onClick={() => handleExport(meta)} disabled={isBusy}>
                    ZIP
                  </Button>
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => setDeleteTargets([meta])} disabled={isBusy}>
                    삭제
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && handleRestore(restoreTarget)}
        title="스냅샷 복원"
        message={
          restoreTarget
            ? `"${restoreTarget.projectTitle}" 스냅샷으로 현재 작업을 바꿉니다.\n설정·용어집·프로젝트 정보도 스냅샷 값으로 바뀝니다.\n\n현재 작업은 자동 스냅샷에 남아 있어 다시 되돌릴 수 있습니다.`
            : ''
        }
        confirmText="복원"
        cancelText="취소"
      />

      <ConfirmDialog
        isOpen={deleteTargets !== null}
        onClose={() => setDeleteTargets(null)}
        onConfirm={() => deleteTargets && handleDelete(deleteTargets)}
        title="스냅샷 삭제"
        message={deleteTargets ? `스냅샷 ${deleteTargets.length}개를 삭제합니다. 되돌릴 수 없습니다.` : ''}
        confirmText="삭제"
        cancelText="취소"
        danger
      />
    </div>
  );
}
