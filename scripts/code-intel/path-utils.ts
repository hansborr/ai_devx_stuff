import path from "node:path";

export function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

export function isInside(relativePath: string): boolean {
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function isSameOrInside(filePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath === "" || isInside(relativePath);
}

export function toSlash(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
