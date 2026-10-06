export type WorkspaceId = "library" | "story" | "edit" | "export";
export type FilmLocale = "en-US" | "zh-TW" | "ja-JP";
export interface FilmCreation {
  title: string;
  path?: string;
  root?: string;
  projectContentLocale: FilmLocale;
  filmSettings: {
    templateId: string;
    targetDuration: number;
    maxDuration: number;
  };
}
export interface RecentProject {
  path: string;
  title: string;
  openedAt: string;
  status: "available" | "missing" | "invalid" | "inaccessible" | "unchecked";
}
export interface WorkflowStep {
  id: "media" | "organize" | "story" | "edit" | "export";
  state: "complete" | "current" | "attention" | "not-started";
}
