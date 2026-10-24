import type { WorkspaceId } from "./appTypes";

export type WorkspaceCommandId =
  | `workspace:${WorkspaceId}`
  | `story:${"outline" | "graph" | "storyboard"}`
  | "new-story"
  | "pipeline"
  | "settings";

export interface WorkspaceCommand {
  id: WorkspaceCommandId;
  label: string;
  icon: string;
  description?: string;
  keywords?: readonly string[];
  disabled?: boolean;
}

const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
export function filterWorkspaceCommands(
  commands: readonly WorkspaceCommand[],
  query: string,
): WorkspaceCommand[] {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    const text = normalized(
      [
        command.label,
        command.description ?? "",
        command.id,
        ...(command.keywords ?? []),
      ].join(" "),
    );
    return terms.every((term) => text.includes(term));
  });
}

export function nextEnabledCommandIndex(
  commands: readonly WorkspaceCommand[],
  from: number,
  direction: 1 | -1,
): number {
  const start = from < 0 ? (direction === 1 ? -1 : 0) : from;
  for (let offset = 1; offset <= commands.length; offset += 1) {
    const index =
      (((start + direction * offset) % commands.length) + commands.length) %
      commands.length;
    if (!commands[index]?.disabled) return index;
  }
  return -1;
}

export function isWorkspaceCommandShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "ctrlKey"
    | "metaKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "repeat"
    | "defaultPrevented"
  >,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "k" &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.repeat &&
    !event.defaultPrevented
  );
}
