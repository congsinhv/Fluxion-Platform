#!/usr/bin/env bash
# Activate Fluxion DPC as Android Device Owner on the connected emulator.
# Run AFTER `./gradlew :app:installDebug`. Idempotent — re-running re-binds.
#
# Env overrides:
#   NO_COLOR  (set to any value to disable colors/animation)
set -euo pipefail

PKG="com.fluxion.client"
ADMIN="${PKG}/.platform.dpc.FluxionDeviceAdminReceiver"

# ----------------------------------------------------------------------------
# Pretty output — colors + spinner when stdout is a TTY; plain text otherwise
# (piped / CI). Honors NO_COLOR.
# ----------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  c_reset=$'\033[0m'; c_dim=$'\033[2m'; c_b=$'\033[1m'
  c_g=$'\033[32m'; c_r=$'\033[31m'; c_c=$'\033[36m'; c_y=$'\033[33m'; c_mag=$'\033[35m'
  USE_TTY=1
else
  c_reset=''; c_dim=''; c_b=''; c_g=''; c_r=''; c_c=''; c_y=''; c_mag=''
  USE_TTY=0
fi
restore_cursor() { [ "$USE_TTY" -eq 1 ] && printf '\033[?25h'; }
trap 'restore_cursor' EXIT
trap 'restore_cursor; printf "\n%saborted%s\n" "$c_y" "$c_reset"; exit 130' INT TERM

rule() { printf ' %s────────────────────────────────────────────%s\n' "$c_dim" "$c_reset"; }
info() { printf '  %s▸%s %s\n' "$c_c" "$c_reset" "$1"; }
ok()   { printf '  %s✔%s %s\n' "$c_g" "$c_reset" "$1"; }

# step "label" cmd args... — run cmd, animate a spinner with elapsed timer,
# print ✔/✘ (+ duration). Captures combined output into SPIN_OUT; returns rc.
SPIN_OUT=''
step() {
  local label="$1"; shift
  local tmp; tmp="$(mktemp "${TMPDIR:-/tmp}/fluxion.XXXXXX")"
  local rc=0 start=$SECONDS
  if [ "$USE_TTY" -eq 1 ]; then
    local frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) i=0 el et
    "$@" >"$tmp" 2>&1 &
    local pid=$!
    printf '\033[?25l'
    while kill -0 "$pid" 2>/dev/null; do
      el=$((SECONDS - start)); et=''; [ "$el" -ge 1 ] && et="${c_dim}(${el}s)${c_reset}"
      printf '\r  %s%s%s %s %s\033[K' "$c_c" "${frames[i % ${#frames[@]}]}" "$c_reset" "$label" "$et"
      i=$((i + 1)); sleep 0.1
    done
    wait "$pid" || rc=$?
    printf '\033[?25h'
    el=$((SECONDS - start)); et=''; [ "$el" -ge 1 ] && et=" ${c_dim}(${el}s)${c_reset}"
    if [ "$rc" -eq 0 ]; then
      printf '\r  %s✔%s %s%s\033[K\n' "$c_g" "$c_reset" "$label" "$et"
    else
      printf '\r  %s✘%s %s\033[K\n' "$c_r" "$c_reset" "$label"
    fi
  else
    printf '  • %s\n' "$label"
    "$@" >"$tmp" 2>&1 || rc=$?
  fi
  SPIN_OUT="$(cat "$tmp")"; rm -f "$tmp"
  return "$rc"
}

fail() {  # fail <rc> <message...> — print message + any captured step output, then exit
  local rc="$1"; shift
  printf '  %s✘ %s%s\n' "$c_r" "$*" "$c_reset" >&2
  [ -n "$SPIN_OUT" ] && printf '%s%s%s\n' "$c_dim" "$SPIN_OUT" "$c_reset" >&2
  exit "$rc"
}

# --- header ---
printf '\n %s%sFluxion%s %s· enroll DPC as Device Owner%s\n' "$c_b" "$c_mag" "$c_reset" "$c_dim" "$c_reset"
rule
printf '   %spackage%s %s\n' "$c_dim" "$c_reset" "$PKG"
printf '   %sadmin%s   %s\n' "$c_dim" "$c_reset" ".platform.dpc.FluxionDeviceAdminReceiver"
rule

# --- adb available? ---
command -v adb >/dev/null 2>&1 || fail 1 "adb not on PATH — add \$ANDROID_HOME/platform-tools"

# --- wait for a device + show its serial ---
step "Waiting for device" adb wait-for-device || fail 1 "no device became available"
DEV="$(adb devices | awk '$2=="device"{print $1; exit}')"
[ -n "$DEV" ] && info "connected: ${c_b}${DEV}${c_reset}"

# --- set-device-owner requires zero accounts on the device ---
ACCOUNTS="$(adb shell dumpsys account 2>/dev/null | sed -n 's/^  Accounts: \([0-9]*\)$/\1/p' | head -1 || true)"
case "$ACCOUNTS" in *[!0-9]* | "") ACCOUNTS=0 ;; esac
[ "$ACCOUNTS" -eq 0 ] \
  || fail 2 "found $ACCOUNTS preinstalled account(s) — wipe AVD or use a Google APIs (not Google Play) image"
ok "device is account-free ${c_dim}(required for set-device-owner)${c_reset}"

# --- set Device Owner ---
step "Setting ${PKG} as Device Owner" \
  adb shell dpm set-device-owner "$ADMIN" \
  || fail 3 "set-device-owner failed (already a device owner? accounts present? non-Google-APIs image?)"

# --- verify (best-effort; show the dumpsys lines) ---
verify_do() { adb shell dumpsys device_policy | grep -A2 "Device Owner"; }
step "Verifying Device Owner" verify_do || true
if [ -n "$SPIN_OUT" ]; then
  while IFS= read -r line; do printf '     %s%s%s\n' "$c_dim" "$line" "$c_reset"; done <<<"$SPIN_OUT"
fi

# --- grant runtime permissions (best-effort) ---
# READ_PHONE_STATE is REQUIRED: a Device Owner can read the real telephony IMEI
# only with this granted; without it the app falls back to an ANDROID_ID-derived
# IMEI the operator never registered, so /v1/enroll returns 404.
# POST_NOTIFICATIONS (API 33+) lets the DPC show command notifications.
grant_perms() {
  adb shell pm grant "$PKG" android.permission.READ_PHONE_STATE || true
  adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
}
step "Granting runtime permissions" grant_perms

# --- done ---
printf '\n %s%s✓ Device Owner active%s\n' "$c_b" "$c_g" "$c_reset"
rule
printf '   %snext%s  launch the DPC app and accept the EULA\n' "$c_dim" "$c_reset"
printf '\n'
