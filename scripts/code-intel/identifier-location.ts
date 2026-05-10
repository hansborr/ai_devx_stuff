import type { Identifier, Node, SourceFile } from "ts-morph";
import { Node as NodeApi, SyntaxKind } from "ts-morph";

import { CodeIntelError } from "./errors.js";
import type { SourceLocation } from "./types.js";

export function positionFromLineColumn(sourceFile: SourceFile, location: SourceLocation): number {
  const text = sourceFile.getFullText();
  let line = 1;
  let position = 0;

  while (line < location.line && position < text.length) {
    if (text.charAt(position) === "\n") line += 1;
    position += 1;
  }

  if (line !== location.line) {
    throw new CodeIntelError(`Line ${String(location.line)} is outside ${location.file}.`);
  }

  return position + location.col - 1;
}

export function identifierAtPosition(
  sourceFile: SourceFile,
  node: Node,
  position: number,
): Identifier | undefined {
  const exact = identifierContainingPosition(node, position);
  return exact ?? nearestIdentifierOnLine(sourceFile, position);
}

function identifierContainingPosition(node: Node, position: number): Identifier | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (NodeApi.isIdentifier(current)) return current;
    current = current.getParent();
  }
  return node
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((identifier) => identifier.getStart() <= position && position <= identifier.getEnd());
}

function nearestIdentifierOnLine(sourceFile: SourceFile, position: number): Identifier | undefined {
  const boundedPosition = Math.min(position, sourceFile.getFullText().length);
  const line = sourceFile.getLineAndColumnAtPos(boundedPosition).line;
  let nearest: Identifier | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const start = identifier.getStart();
    if (sourceFile.getLineAndColumnAtPos(start).line !== line) continue;
    const distance = distanceFromRange(position, start, identifier.getEnd());
    if (distance >= nearestDistance) continue;
    nearest = identifier;
    nearestDistance = distance;
  }

  return nearest;
}

function distanceFromRange(position: number, start: number, end: number): number {
  if (position < start) return start - position;
  if (position > end) return position - end;
  return 0;
}
