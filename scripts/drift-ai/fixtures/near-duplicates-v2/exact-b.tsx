export function smallExactB(input: number): number {
  const doubled = input * 2;
  return Math.max(doubled, input + 10);
}

export function signatureDefaultChanged(input = 3): number {
  const doubled = input * 2;
  return Math.max(doubled, input + 10);
}

export async function signatureAsyncChanged(input: number): Promise<number> {
  const doubled = input * 2;
  return Math.max(doubled, input + 10);
}

export function formattedB(input: number): number {
  // Formatting and comments are trivia.
  const value=input+4;

  return value*Math.max(input,2);
}

export function identifierChanged(input: number): number {
  const renamed = input + 4;
  return renamed * Math.max(input, 2);
}

export function propertyChanged(input: { beta: number }): number {
  const value = input.beta + 4;
  return value * Math.max(input.beta, 2);
}

export function operatorChanged(input: number | null): number {
  const value = input || 4;
  return value * Math.max(value, 2);
}

export function stringB(input: string): string {
  const value = "alpha / /* exact */";
  return value.includes(input) ? `${value}:${input}` : `${input}:${value}`;
}

export function stringChanged(input: string): string {
  const value = "alpha /  /* exact */";
  return value.includes(input) ? `${value}:${input}` : `${input}:${value}`;
}

export function numericB(input: number): number {
  const value = 0xff + 1_000;
  return value + input * 2;
}

export function numericChanged(input: number): number {
  const value = 255 + 1_000;
  return value + input * 2;
}

export function bigintB(input: bigint): bigint {
  const value = 0x10n + 2n;
  return value + input * 2n;
}

export function bigintChanged(input: bigint): bigint {
  const value = 16n + 2n;
  return value + input * 2n;
}

export function booleanB(input: boolean): boolean {
  const value = true;
  return value && input !== false && Boolean(input);
}

export function booleanChanged(input: boolean): boolean {
  const value = false;
  return value && input !== false && Boolean(input);
}

export function nullB(input: string | null): string | null {
  const value = null;
  return input === value ? null : input;
}

export function nullChanged(input: string | null): string | null {
  const value = "null";
  return input === value ? null : input;
}

export function regexB(input: string): boolean {
  const pattern = /https?:\/\/[^/*]+\/a\/*b(?:\+|-)/giu;
  return pattern.test(input) && input.length > 2;
}

export function regexChanged(input: string): boolean {
  const pattern = /https?:\/\/[^/*]+\/a\/+b(?:\+|-)/giu;
  return pattern.test(input) && input.length > 2;
}

export function noSubTemplateB(input: string): string {
  const value = `alpha  beta / *`;
  return value + input.toUpperCase();
}

export function noSubTemplateChanged(input: string): string {
  const value = `alpha beta / *`;
  return value + input.toUpperCase();
}

export function templateB(input: string): string {
  const value = `head ${input.trim()} middle ${input.length} tail`;
  return value + input.toUpperCase();
}

export function templateChanged(input: string): string {
  const value = `head ${input.trim()}  middle ${input.length} tail`;
  return value + input.toUpperCase();
}

export function jsxB(input: string): JSX.Element {
  const value = <section data-label="alpha  beta">Text  gap {input.trim()}</section>;
  return <div className="wrapper">{value}{input.length}</div>;
}

export function jsxChanged(input: string): JSX.Element {
  const value = <section data-label="alpha beta">Text gap {input.trim()}</section>;
  return <div className="wrapper">{value}{input.length}</div>;
}

export class PrivateB {
  readonly #value = 2;

  privateExactB(input: number): number {
    const value = this.#value + input;
    return value * Math.max(input, 2);
  }
}

export class PrivateChanged {
  readonly #other = 2;

  privateChanged(input: number): number {
    const value = this.#other + input;
    return value * Math.max(input, 2);
  }
}
