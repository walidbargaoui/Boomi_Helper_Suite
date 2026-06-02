import type { FmdSection, Project } from "@/lib/domain";
import type { FmdSectionType } from "@/lib/fmd-section-schemas";

export interface SectionEditorProps {
  section: FmdSection;
  project: Project;
  onSave: (content: Record<string, unknown>, extra?: { title?: string; sectionType?: string }) => Promise<void>;
  saving: boolean;
  onProjectFieldUpdate?: (field: string, value: string) => Promise<void>;
}

type EditorComponent = React.ComponentType<SectionEditorProps>;

const editorMap = new Map<FmdSectionType, EditorComponent>();

export function registerEditor(sectionType: FmdSectionType, component: EditorComponent): void {
  editorMap.set(sectionType, component);
}

export function getEditor(sectionType: string): EditorComponent | null {
  return editorMap.get(sectionType as FmdSectionType) ?? null;
}
