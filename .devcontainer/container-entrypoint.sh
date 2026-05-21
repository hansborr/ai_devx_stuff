#!/usr/bin/env bash
# Wait for postCreateCommand to finish (it creates .setup-complete as its last step)
SENTINEL="/workspace/.setup-complete"
MAX_WAIT=120  # 10 minutes (5s × 120)
count=0
while [ $count -lt $MAX_WAIT ]; do
  [ -f "$SENTINEL" ] && break
  sleep 5
  count=$((count + 1))
done

mkdir -p /tmp/musi_logs

if [ -f "$SENTINEL" ]; then
  cd /workspace || exit 1
  bun run dev >> /tmp/musi_logs/dev-servers.log 2>&1 &
  echo "$(date -Iseconds): dev servers started (PID $!)" >> /tmp/musi_logs/dev-servers.log
  # Sweep orphan per-worktree databases. Runs on every container start so
  # the three-tier GC scheme fires even for users who never touch VSCode's
  # postStartCommand.
  (cd /workspace && bun run worktree:gc) >> /tmp/musi_logs/worktree-gc.log 2>&1 &
else
  echo "$(date -Iseconds): setup not complete after $((MAX_WAIT * 5))s — servers not started" >> /tmp/musi_logs/dev-servers.log
fi

exec sleep infinity
