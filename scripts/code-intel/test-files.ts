// Code-intel's strict runnable-test policy (scripts/lib/path-taxonomy.ts):
// only `.test.ts(x)` files, because these predicates feed runnable-test
// queries. `.spec` and directory conventions are deliberately excluded.
export {
  isSlowRunnableTestPath as isSlowTestFile,
  isRunnableTestPath as isTestFile,
} from "../lib/path-taxonomy.js";
