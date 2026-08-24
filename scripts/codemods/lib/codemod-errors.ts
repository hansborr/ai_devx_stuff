export class CodemodError extends Error {
  constructor(codemodName: string, message: string) {
    super(`${codemodName} codemod: ${message}`);
    this.name = "CodemodError";
  }
}

export function fail(codemodName: string, message: string): never {
  throw new CodemodError(codemodName, message);
}
