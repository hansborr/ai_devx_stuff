#!/usr/bin/env bash
# Shared environment defaults for local gate wrappers.

MUSI_GATE_DEFAULT_NODE_OLD_SPACE_MB=6144

musi_gate_node_options_has_old_space() {
  case " ${NODE_OPTIONS:-} " in
    *" --max-old-space-size="* | *" --max_old_space_size="*) return 0 ;;
    *) return 1 ;;
  esac
}

musi_apply_gate_node_options() {
  local old_space_mb="${MUSI_GATE_NODE_OLD_SPACE_MB:-$MUSI_GATE_DEFAULT_NODE_OLD_SPACE_MB}"
  case "$old_space_mb" in
    "" | *[!0-9]*) old_space_mb="$MUSI_GATE_DEFAULT_NODE_OLD_SPACE_MB" ;;
  esac

  if ! musi_gate_node_options_has_old_space; then
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$old_space_mb"
  fi
}

musi_apply_gate_node_options
