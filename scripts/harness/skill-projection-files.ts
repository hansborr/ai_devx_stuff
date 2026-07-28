import type { Dirent } from "node:fs";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import type { SkillOverlay, SkillTarget, SkillWiring } from "./skill-inventory-schema.js";
import { projectFrontmatterOverlay, projectHarnessOverlay } from "./skill-overlay-content.js";

export interface FileArtifact {
  readonly content: Buffer;
  readonly mode: number;
}

export interface FileTree {
  readonly exists: boolean;
  readonly files: ReadonlyMap<string, FileArtifact>;
}

interface ProjectionContext {
  readonly canonicalHarness: string;
  readonly context: string;
  readonly current: FileTree;
  readonly target: SkillTarget;
}

function error(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

export function assertRepoRelativePath(path: string, context: string): void {
  const invalidPart = path.split("/").some((part) => part === "" || part === "." || part === "..");
  if (path === "" || isAbsolute(path) || path.includes("\\") || invalidPart) {
    error(context, `must be a normalized repo-relative POSIX path; got ${path}`);
  }
}

export function assertInsideRepo(repoRoot: string, path: string, context: string): string {
  assertRepoRelativePath(path, context);
  const absoluteRepoRoot = resolve(repoRoot);
  const absolute = resolve(absoluteRepoRoot, path);
  const lexicalRelative = relative(absoluteRepoRoot, absolute);
  if (isAbsolute(lexicalRelative) || lexicalRelative.startsWith("..")) {
    error(context, `escapes repo root: ${path}`);
  }
  assertNoSymlinkComponents(absoluteRepoRoot, path, context);
  assertPhysicalContainment(absoluteRepoRoot, absolute, path, context);
  return absolute;
}

function assertNoSymlinkComponents(repoRoot: string, path: string, context: string): void {
  let cursor = repoRoot;
  for (const part of path.split("/")) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) return;
    if (lstatSync(cursor).isSymbolicLink()) error(context, `must not traverse a symlink: ${path}`);
  }
}

function assertPhysicalContainment(
  repoRoot: string,
  absolute: string,
  path: string,
  context: string,
): void {
  if (!existsSync(absolute)) return;
  const physicalRelative = relative(realpathSync(repoRoot), realpathSync(absolute));
  if (isAbsolute(physicalRelative) || physicalRelative.startsWith("..")) {
    error(context, `resolves outside repo root: ${path}`);
  }
}

interface FileWalk {
  readonly context: string;
  readonly files: Map<string, FileArtifact>;
  readonly root: string;
}

function collectFiles(root: string, context: string): Map<string, FileArtifact> {
  const walk: FileWalk = { context, files: new Map(), root };
  collectDirectory(walk, "");
  return walk.files;
}

function collectDirectory(walk: FileWalk, prefix: string): void {
  const directory = prefix === "" ? walk.root : join(walk.root, prefix);
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareByCodepoint(left.name, right.name),
  );
  for (const entry of entries) collectEntry(walk, prefix, entry);
}

function collectEntry(walk: FileWalk, prefix: string, entry: Dirent): void {
  const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isSymbolicLink())
    error(walk.context, `skill tree contains unsupported symlink: ${path}`);
  if (entry.isDirectory()) {
    collectDirectory(walk, path);
    return;
  }
  if (!entry.isFile()) error(walk.context, `skill tree contains unsupported file type: ${path}`);
  const absolute = join(walk.root, path);
  walk.files.set(path, { content: readFileSync(absolute), mode: lstatSync(absolute).mode });
}

export function readFileTree(root: string, context: string, allowMissing: boolean): FileTree {
  if (!existsSync(root)) {
    if (!allowMissing) error(context, "skill root is missing");
    return { exists: false, files: new Map() };
  }
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) error(context, "skill root must not be a symlink");
  if (!rootStat.isDirectory()) error(context, "skill root is not a directory");
  return { exists: true, files: collectFiles(root, context) };
}

function pathMatchesOverlay(path: string, overlay: SkillOverlay): boolean {
  return path === overlay.path || path.startsWith(`${overlay.path}/`);
}

function overlayFor(path: string, overlays: readonly SkillOverlay[]): SkillOverlay | undefined {
  return overlays.find((overlay) => pathMatchesOverlay(path, overlay));
}

function validateOverlayDeclarations(overlays: readonly SkillOverlay[], context: string): void {
  for (const overlay of overlays)
    assertRepoRelativePath(overlay.path, `${context}.${overlay.path}`);
  for (const [index, overlay] of overlays.entries()) {
    for (const other of overlays.slice(index + 1))
      assertOverlaysDoNotOverlap(overlay, other, context);
  }
}

function assertOverlaysDoNotOverlap(
  overlay: SkillOverlay,
  other: SkillOverlay,
  context: string,
): void {
  if (pathMatchesOverlay(overlay.path, other) || pathMatchesOverlay(other.path, overlay)) {
    error(context, `overlay paths overlap: ${overlay.path} and ${other.path}`);
  }
}

function assertBootstrapInputs(projection: ProjectionContext): void {
  if (projection.current.exists) return;
  const authored = projection.target.overlays.find(
    (overlay) => overlay.kind === "target-only" || overlay.kind === "harness-block",
  );
  if (authored !== undefined) {
    error(
      projection.context,
      `cannot bootstrap ${authored.kind} overlay ${authored.path}; seed its target-owned input first`,
    );
  }
}

function validateOverlayMatches(canonical: FileTree, projection: ProjectionContext): void {
  const unionPaths = new Set([...canonical.files.keys(), ...projection.current.files.keys()]);
  for (const overlay of projection.target.overlays) {
    const contentOverlay = overlay.kind === "harness-block" || overlay.kind === "frontmatter-field";
    if (contentOverlay && !canonical.files.has(overlay.path)) {
      error(
        projection.context,
        `${overlay.kind} content overlay names a path absent from canonical: ${overlay.path}`,
      );
    }
    const matches = [...unionPaths].filter((path) => pathMatchesOverlay(path, overlay));
    if (matches.length === 0) {
      error(projection.context, `permitted overlay matches no skill file: ${overlay.path}`);
    }
    if (contentOverlay && (matches.length !== 1 || matches[0] !== overlay.path)) {
      error(
        projection.context,
        `${overlay.kind} overlay must name exactly one file: ${overlay.path}`,
      );
    }
  }
}

function projectCanonicalFile(
  path: string,
  artifact: FileArtifact,
  projection: ProjectionContext,
): FileArtifact | undefined {
  const overlay = overlayFor(path, projection.target.overlays);
  if (overlay?.kind === "target-only") {
    error(projection.context, `${path} is forbidden in canonical by its target-only overlay`);
  }
  if (overlay?.kind === "canonical-only") return undefined;
  if (overlay?.kind === "harness-block") {
    return projectHarnessOverlay(artifact, projection.current.files.get(path), {
      canonicalHarness: projection.canonicalHarness,
      context: `${projection.context}.${path}`,
      targetHarness: projection.target.harness,
    });
  }
  if (overlay?.kind === "frontmatter-field") {
    return projectFrontmatterOverlay(
      artifact,
      projection.current.files.get(path),
      overlay.field,
      `${projection.context}.${path}`,
    );
  }
  return artifact;
}

function preserveTargetOwnedFiles(
  projected: Map<string, FileArtifact>,
  projection: ProjectionContext,
): void {
  for (const [path, artifact] of projection.current.files) {
    const overlay = overlayFor(path, projection.target.overlays);
    if (overlay?.kind === "canonical-only") {
      error(projection.context, `${path} is forbidden in target by its canonical-only overlay`);
    }
    if (overlay?.kind === "target-only") projected.set(path, artifact);
  }
}

export function projectTargetFiles(
  skill: SkillWiring,
  target: SkillTarget,
  canonicalHarness: string,
  trees: { readonly canonical: FileTree; readonly current: FileTree },
): ReadonlyMap<string, FileArtifact> {
  const projection: ProjectionContext = {
    canonicalHarness,
    context: `${skill.id}.${target.harness}`,
    current: trees.current,
    target,
  };
  validateOverlayDeclarations(target.overlays, `${projection.context}.overlays`);
  assertBootstrapInputs(projection);
  validateOverlayMatches(trees.canonical, projection);
  const projected = new Map<string, FileArtifact>();
  for (const [path, artifact] of trees.canonical.files) {
    const output = projectCanonicalFile(path, artifact, projection);
    if (output !== undefined) projected.set(path, output);
  }
  preserveTargetOwnedFiles(projected, projection);
  return projected;
}
