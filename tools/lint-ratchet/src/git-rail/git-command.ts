import { spawnSync } from "node:child_process";

export interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    ...(env === undefined ? {} : { env }),
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function gitOutput(cwd: string, args: readonly string[]): string {
  const result = runCommand("git", args, cwd);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

export function tryGitOutput(cwd: string, args: readonly string[]): string | undefined {
  const result = runCommand("git", args, cwd);
  return result.status === 0 ? result.stdout.trim() : undefined;
}
