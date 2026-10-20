/** Only authored local values cross a native service restart. No action receipts or consent. */
export interface NativeBeatDraft {
  title: string;
  intent: string;
  targetDuration: number;
  selectedAssetIds: string[];
  narration: string;
  visualDirection: string;
}
export interface NativePlannerInputs {
  title: string;
  brief: string;
  groupBy: "category" | "chronology";
  scope: "library" | "page";
  target: number | string;
  maximum: number | string;
  transition: "cut" | "crossfade";
}
export interface NativePlannerText {
  scene: number;
  field: string;
  text: string;
}
interface Owner {
  projectId: string;
  projectPath: string;
  projectTitle: string;
  entityId: string;
  label: string;
  baseline: string;
}
export type NativeLocalDraft = Owner &
  (
    | { kind: "beat"; storyId: string; value: NativeBeatDraft }
    | { kind: "category"; value: string[] }
    | { kind: "planner"; value: NativePlannerInputs }
    | { kind: "planner-text"; value: NativePlannerText[] }
  );
export type RetainedNativeDraft = NativeLocalDraft & {
  id: number;
  generation: number;
};
