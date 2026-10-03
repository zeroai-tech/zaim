#!/bin/sh
# Paths are positional arguments, never interpolated into executable shell text.
set -eu
zaim_pid=$1
zaim_app=$2
zaim_replacement=$3
zaim_backup=$4
zaim_updates=$5
zaim_version=$6
zaim_port=$7
zaim_log=$8
zaim_stage=$9
exec > "$zaim_log" 2>&1
zaim_count=0
while kill -0 "$zaim_pid" 2>/dev/null; do
  zaim_count=$((zaim_count + 1))
  [ "$zaim_count" -lt 120 ] || exit 1
  sleep 0.25
done
sleep 1
mv "$zaim_app" "$zaim_backup"
if ! mv "$zaim_replacement" "$zaim_app"; then
  mv "$zaim_backup" "$zaim_app"
  "$zaim_app/Contents/MacOS/Zaim" > /dev/null 2>&1 &
  exit 1
fi
"$zaim_app/Contents/MacOS/Zaim" > /dev/null 2>&1 &
zaim_new_pid=$!
zaim_count=0
zaim_ready=0
while [ "$zaim_count" -lt "${ZAIM_UPDATE_WAIT_LIMIT:-120}" ]; do
  zaim_count=$((zaim_count + 1))
  if curl -fsS --max-time 1 "http://127.0.0.1:$zaim_port/api/desktop/health" | grep -F "\"version\":\"$zaim_version\"" >/dev/null; then
    zaim_ready=1
    break
  fi
  kill -0 "$zaim_new_pid" 2>/dev/null || break
  sleep 0.25
done
if [ "$zaim_ready" -eq 1 ]; then
  mv "$zaim_updates/pending.zip" "$zaim_updates/installed.zip"
  if [ -f "$zaim_updates/pending.blockmap.json" ]; then
    mv "$zaim_updates/pending.blockmap.json" "$zaim_updates/installed.blockmap.json"
  else
    rm -f "$zaim_updates/installed.blockmap.json"
  fi
  rm -f "$zaim_updates/pending.json"
  rm -rf "$zaim_backup" "$zaim_stage"
else
  kill "$zaim_new_pid" 2>/dev/null || true
  sleep 1
  rm -rf "$zaim_app"
  mv "$zaim_backup" "$zaim_app"
  rm -rf "$zaim_stage"
  "$zaim_app/Contents/MacOS/Zaim" > /dev/null 2>&1 &
  echo 'Update did not start correctly; restored the previous application.'
  exit 1
fi
