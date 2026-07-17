import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SkillOverlay } from "./skill-inventory-schema.js";

interface SkillTreeListing {
  readonly files: string[];
  readonly symlinks: string[];
}

interface TreeComparison {
  readonly canonicalRoot: string;
  readonly targetRoot: string;
  readonly canonicalFiles: ReadonlySet<string>;
  readonly targetFiles: ReadonlySet<string>;
  readonly overlays: readonly SkillOverlay[];
}

function listFiles(root: string, prefix = ""): SkillTreeListing {
  const files: string[] = [];
  const symlinks: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      const nested = listFiles(root, path);
      files.push(...nested.files);
      symlinks.push(...nested.symlinks);
    } else if (entry.isFile()) files.push(path);
    else if (entry.isSymbolicLink()) symlinks.push(path);
  }
  return { files: files.sort(), symlinks: symlinks.sort() };
}

function assertSkillRoot(root: string, label: "canonical" | "target"): void {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error(`${label} skill root must not be a symlink`);
  if (!rootStat.isDirectory()) throw new Error(`${label} skill root is not a directory`);
}

function overlayFor(path: string, overlays: readonly SkillOverlay[]): SkillOverlay | undefined {
  return overlays.find((overlay) => path === overlay.path || path.startsWith(`${overlay.path}/`));
}

function stripHarnessBlock(text: string): { readonly text: string; readonly blocks: number } {
  let blocks = 0;
  return {
    text: text.replace(
      /<!-- BEGIN HARNESS-SPECIFIC:[^>]*-->[\s\S]*?<!-- END HARNESS-SPECIFIC -->\n?/gu,
      () => {
        blocks += 1;
        return "";
      },
    ),
    get blocks() {
      return blocks;
    },
  };
}

function stripFrontmatterField(
  text: string,
  field: string,
): { readonly text: string; readonly fields: number; readonly valid: boolean } {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  const valid = lines[0] === "---" && end > 0;
  if (!valid) return { text, fields: 0, valid };
  let fields = 0;
  const output = lines.filter((line, index) => {
    const matches = index > 0 && index < end && line.startsWith(`${field}:`);
    if (matches) fields += 1;
    return !matches;
  });
  return { text: output.join("\n"), fields, valid };
}

function compareOverlayFile(
  canonicalPath: string,
  targetPath: string,
  relativePath: string,
  overlay: SkillOverlay,
): string[] {
  const canonicalText = readFileSync(canonicalPath, "utf8");
  const targetText = readFileSync(targetPath, "utf8");
  if (overlay.kind === "harness-block") {
    const canonical = stripHarnessBlock(canonicalText);
    const target = stripHarnessBlock(targetText);
    if (canonical.blocks !== 1 || target.blocks !== 1) {
      return [`${relativePath} must contain exactly one harness-specific block in each target`];
    }
    return canonical.text === target.text
      ? []
      : [`${relativePath} differs outside permitted harness-specific blocks`];
  }
  if (overlay.kind === "frontmatter-field") {
    const canonical = stripFrontmatterField(canonicalText, overlay.field);
    const target = stripFrontmatterField(targetText, overlay.field);
    if (!canonical.valid || !target.valid) {
      return [
        `${relativePath} must contain an opening and closing frontmatter block in each target`,
      ];
    }
    if (canonical.fields + target.fields !== 1) {
      return [`${relativePath} must contain one permitted frontmatter field ${overlay.field}`];
    }
    return canonical.text === target.text
      ? []
      : [`${relativePath} differs outside permitted frontmatter field ${overlay.field}`];
  }
  return [];
}

function forbiddenOverlayFailure(
  path: string,
  inCanonical: boolean,
  inTarget: boolean,
  overlay: SkillOverlay | undefined,
): string | undefined {
  if (overlay?.kind === "canonical-only" && inTarget) {
    return `${path} is forbidden in target by its canonical-only overlay`;
  }
  if (overlay?.kind === "target-only" && inCanonical) {
    return `${path} is forbidden in canonical by its target-only overlay`;
  }
  return undefined;
}

function isContentOverlay(
  overlay: SkillOverlay | undefined,
): overlay is Extract<SkillOverlay, { readonly kind: "harness-block" | "frontmatter-field" }> {
  return overlay?.kind === "harness-block" || overlay?.kind === "frontmatter-field";
}

function missingPathFailure(
  path: string,
  inCanonical: boolean,
  inTarget: boolean,
  overlay: SkillOverlay | undefined,
): string[] {
  const allowed =
    (overlay?.kind === "canonical-only" && inCanonical) ||
    (overlay?.kind === "target-only" && inTarget);
  return allowed
    ? []
    : [
        `${path} exists only in ${inCanonical ? "canonical" : "target"} without a permitted overlay`,
      ];
}

function compareSkillPath(context: TreeComparison, path: string): string[] {
  const overlay = overlayFor(path, context.overlays);
  const inCanonical = context.canonicalFiles.has(path);
  const inTarget = context.targetFiles.has(path);
  const forbidden = forbiddenOverlayFailure(path, inCanonical, inTarget, overlay);
  if (forbidden !== undefined) return [forbidden];
  if (!inCanonical || !inTarget) {
    return missingPathFailure(path, inCanonical, inTarget, overlay);
  }
  if (isContentOverlay(overlay)) {
    return compareOverlayFile(
      join(context.canonicalRoot, path),
      join(context.targetRoot, path),
      path,
      overlay,
    );
  }
  return readFileSync(join(context.canonicalRoot, path)).equals(
    readFileSync(join(context.targetRoot, path)),
  )
    ? []
    : [`${path} differs without a permitted overlay`];
}

export function compareSkillTrees(
  canonicalRoot: string,
  targetRoot: string,
  overlays: readonly SkillOverlay[],
): string[] {
  assertSkillRoot(canonicalRoot, "canonical");
  assertSkillRoot(targetRoot, "target");
  const canonicalListing = listFiles(canonicalRoot);
  const targetListing = listFiles(targetRoot);
  const context: TreeComparison = {
    canonicalRoot,
    targetRoot,
    canonicalFiles: new Set(canonicalListing.files),
    targetFiles: new Set(targetListing.files),
    overlays,
  };
  const paths = [...new Set([...context.canonicalFiles, ...context.targetFiles])].sort();
  return [
    ...canonicalListing.symlinks.map(
      (path) => `canonical skill tree contains unsupported symlink: ${path}`,
    ),
    ...targetListing.symlinks.map(
      (path) => `target skill tree contains unsupported symlink: ${path}`,
    ),
    ...paths.flatMap((path) => compareSkillPath(context, path)),
    ...overlays
      .filter((overlay) => !paths.some((path) => overlayFor(path, [overlay]) !== undefined))
      .map((overlay) => `permitted overlay matches no skill file: ${overlay.path}`),
  ];
}
