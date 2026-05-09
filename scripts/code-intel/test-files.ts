export function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/u.test(file);
}

export function isSlowTestFile(file: string): boolean {
  return /\.slow\.test\.tsx?$/u.test(file);
}
