import type { CommitRecord } from "./hotspots-history.js";
import type { OwnershipIdentity } from "./ownership-types.js";

export function parseIdentity(value: string): OwnershipIdentity {
  const trimmed = value.trim();
  if (!trimmed.endsWith(">")) return { name: trimmed, email: null };
  const open = trimmed.lastIndexOf("<");
  if (open <= 0) return { name: trimmed, email: null };
  const name = trimmed.slice(0, open).trim();
  const email = trimmed.slice(open + 1, -1).trim();
  if (email.length === 0) return { name: trimmed, email: null };
  return { name: name.length > 0 ? name : email, email };
}

export function formatIdentity(identity: OwnershipIdentity): string {
  return identity.email === null ? identity.name : `${identity.name} <${identity.email}>`;
}

export function authorIdentity(record: CommitRecord): OwnershipIdentity {
  const name = record.authorName.trim();
  const email = record.authorEmail.trim();
  return { name: name.length > 0 ? name : email, email: email.length > 0 ? email : null };
}

export function identityKey(identity: OwnershipIdentity): string {
  if (identity.email !== null) return `email:${identity.email.toLowerCase()}`;
  return `name:${identity.name.toLowerCase()}`;
}

export function isAgentIdentity(identity: OwnershipIdentity, matchers: readonly RegExp[]): boolean {
  const value = formatIdentity(identity);
  return matchers.some((matcher) => matcher.test(value));
}

export function compileAgentMatchers(patterns: readonly string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "iu"));
}
