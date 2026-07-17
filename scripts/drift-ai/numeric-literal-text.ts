function numericLiteralDigitCount(sourceText: string): number {
  const normalized = sourceText.replace(/^[+-]/u, "").replace(/[_.]/gu, "");
  const hexadecimalDigits = normalized.match(/^0x([0-9a-f]+)$/iu)?.[1];
  if (hexadecimalDigits !== undefined) return hexadecimalDigits.length;
  const binaryDigits = normalized.match(/^0b([01]+)$/iu)?.[1];
  if (binaryDigits !== undefined) return binaryDigits.length;
  const octalDigits = normalized.match(/^0o([0-7]+)$/iu)?.[1];
  if (octalDigits !== undefined) return octalDigits.length;
  return normalized.match(/\d/gu)?.length ?? 0;
}

export function hasMinNumericLiteralDigits(sourceText: string, minDigits: number): boolean {
  return numericLiteralDigitCount(sourceText) >= minDigits;
}
