// src/stores/projectStore.ts
// 프로젝트 메타데이터 상태 관리 (Zustand)

import { create } from 'zustand';
import { 
  ProjectMetadata, 
  createDefaultProjectMetadata 
} from '../types/project';

interface ProjectState {
  project: ProjectMetadata;
  updateProject: (updates: Partial<ProjectMetadata>) => void;
  setProject: (project: ProjectMetadata) => void;
  resetProject: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createDefaultProjectMetadata(),

  updateProject: (updates) =>
    set((state) => ({
      project: {
        ...state.project,
        ...updates,
      },
    })),

  setProject: (project) => set({ project }),

  resetProject: () =>
    set({
      project: createDefaultProjectMetadata(),
    }),
}));
