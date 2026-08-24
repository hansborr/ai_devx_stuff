import { fail as failWithName } from "../lib/codemod-errors.js";
import { CODEMOD_NAME } from "./constants.js";

export function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}
