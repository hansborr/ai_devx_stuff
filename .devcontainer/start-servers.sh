#!/usr/bin/env bash
mkdir -p /tmp/musi_logs
cd /workspace || exit 1
setsid nohup bun run dev >> /tmp/musi_logs/dev-servers.log 2>&1 &
