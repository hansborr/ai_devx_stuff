#!/usr/bin/env bash

musi_clear_inherited_git_hook_env() {
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_COMMON_DIR
}

musi_assert_inherited_git_hook_env_cleared() {
  local var_name

  for var_name in GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX GIT_COMMON_DIR; do
    if [ -n "${!var_name:-}" ]; then
      printf 'test-git-env: %s still set\n' "$var_name" >&2
      return 1
    fi
  done
}

musi_exit_after_git_hook_env_assertion_if_requested() {
  if [ "${MUSI_TEST_ASSERT_GIT_HOOK_ENV_CLEARED:-0}" = "1" ]; then
    musi_assert_inherited_git_hook_env_cleared
    exit $?
  fi
}
