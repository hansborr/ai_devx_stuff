// The one shared spelling of the Node/Bun argv layout constant (ready-2026-07
// leaf 16): `process.argv[0]` is the runtime, `process.argv[1]` the entry
// script, so user arguments start at index 2. CLI entry guards slice with this
// constant instead of respelling it (`PROCESS_ARG_OFFSET`,
// `nodeArgvUserArgumentOffset`, ...), which had defeated symbol search for one
// concept. Existing CLIs converge opportunistically; new CLIs import it.
export const PROCESS_ARGV_USER_ARGS_START = 2;
