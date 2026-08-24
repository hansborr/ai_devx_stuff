#!/usr/bin/env bun
import { runLintRatchetGitRailCliMain } from "../src/git-rail/executable-cli.js";

const PROCESS_ARGV_USER_ARGS_START = 2;

await runLintRatchetGitRailCliMain(process.argv.slice(PROCESS_ARGV_USER_ARGS_START));
