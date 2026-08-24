export interface PackageInfo {
  name: string;
  version: string;
  license: string;
  manifestPath: string;
}

export const STRONG_COPYLEFT_RE = /\b(?:AGPL|GPL|SSPL)\b/i;
export const REVIEW_COPYLEFT_RE = /\b(?:LGPL|MPL|EPL|CDDL|CPL|OSL|RPL)\b/i;

export interface LicenseAuditClassification {
  readonly strongCopyleft: PackageInfo[];
  readonly reviewCopyleft: PackageInfo[];
  readonly unknown: PackageInfo[];
  readonly flaggedCount: number;
  readonly shouldFail: boolean;
}

export function classifyLicenseAudit(packages: PackageInfo[]): LicenseAuditClassification {
  const strongCopyleft = packages.filter((pkg) => STRONG_COPYLEFT_RE.test(pkg.license));
  const reviewCopyleft = packages.filter((pkg) => REVIEW_COPYLEFT_RE.test(pkg.license));
  const unknown = packages.filter(
    (pkg) => pkg.license === "UNKNOWN" || pkg.license === "UNLICENSED",
  );

  // A compound license ("GPL-3.0 OR LGPL-3.0") can match more than one
  // category; count distinct packages so the summary never double-counts.
  const flaggedCount = new Set(
    [...strongCopyleft, ...reviewCopyleft, ...unknown].map((pkg) => `${pkg.name}@${pkg.version}`),
  ).size;

  return {
    strongCopyleft,
    reviewCopyleft,
    unknown,
    flaggedCount,
    shouldFail: strongCopyleft.length > 0 || reviewCopyleft.length > 0,
  };
}
