import * as nativePath from "node:path";

export function isInside(
  parent: string,
  child: string,
  path: Pick<typeof nativePath, "relative" | "isAbsolute" | "sep"> = nativePath,
): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}
