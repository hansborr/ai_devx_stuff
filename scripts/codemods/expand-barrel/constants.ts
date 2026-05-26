import path from "node:path";

export const CODEMOD_NAME = "expand-barrel";
export const PACKAGES_ROOT = "packages";
export const SHARED_SRC_ROOT = path.join("packages", "shared", "src");

export type KnownPackageBarrel = {
  readonly barrelRelativePath: string;
  readonly packageSpecifier: string;
};

export const KNOWN_PACKAGE_BARRELS: readonly KnownPackageBarrel[] = [
  {
    barrelRelativePath: path.join("packages", "shared", "src", "rules", "index.ts"),
    packageSpecifier: "@musi/shared/rules",
  },
  {
    barrelRelativePath: path.join("packages", "shared", "src", "dice", "index.ts"),
    packageSpecifier: "@musi/shared/dice",
  },
  {
    barrelRelativePath: path.join("packages", "shared", "src", "map", "index.ts"),
    packageSpecifier: "@musi/shared/map",
  },
];
