import { activeVersion } from '@/domain/factory';
import type { Layer, Project } from '@/domain/types';
import { useStudio } from './store';

export const useProject = (): Project => useStudio((s) => s.project!);
export const useVersion = () => useStudio((s) => activeVersion(s.project!));
export const useSelectedLayer = (): Layer | null =>
  useStudio((s) => (s.selectedLayerId ? (activeVersion(s.project!).layers.find((l) => l.id === s.selectedLayerId) ?? null) : null));
