export function smallExactA(input: number): number {
  const doubled = input * 2;
  return Math.max(doubled, input + 10);
}

export function signatureDefaultA(input = 2): number {
  const doubled = input * 2;
  return Math.max(doubled, input + 10);
}

export function signatureAsyncA(input: number): number {
  const doubled = input * 2;
  return Math.max(doubled, input + 10);
}

export function formattedA(input: number): number {
  const value = input + 4;
  return value * Math.max(input, 2);
}

export function identifierA(input: number): number {
  const original = input + 4;
  return original * Math.max(input, 2);
}

export function propertyA(input: { alpha: number }): number {
  const value = input.alpha + 4;
  return value * Math.max(input.alpha, 2);
}

export function operatorA(input: number | null): number {
  const value = input ?? 4;
  return value * Math.max(value, 2);
}

export function stringA(input: string): string {
  const value = "alpha / /* exact */";
  return value.includes(input) ? `${value}:${input}` : `${input}:${value}`;
}

export function numericA(input: number): number {
  const value = 0xff + 1_000;
  return value + input * 2;
}

export function bigintA(input: bigint): bigint {
  const value = 0x10n + 2n;
  return value + input * 2n;
}

export function booleanA(input: boolean): boolean {
  const value = true;
  return value && input !== false && Boolean(input);
}

export function nullA(input: string | null): string | null {
  const value = null;
  return input === value ? null : input;
}

export function regexA(input: string): boolean {
  const pattern = /https?:\/\/[^/*]+\/a\/*b(?:\+|-)/giu;
  return pattern.test(input) && input.length > 2;
}

export function noSubTemplateA(input: string): string {
  const value = `alpha  beta / *`;
  return value + input.toUpperCase();
}

export function templateA(input: string): string {
  const value = `head ${input.trim()} middle ${input.length} tail`;
  return value + input.toUpperCase();
}

export function jsxA(input: string): JSX.Element {
  const value = <section data-label="alpha  beta">Text  gap {input.trim()}</section>;
  return <div className="wrapper">{value}{input.length}</div>;
}

export class PrivateA {
  readonly #value = 2;

  privateExactA(input: number): number {
    const value = this.#value + input;
    return value * Math.max(input, 2);
  }
}
