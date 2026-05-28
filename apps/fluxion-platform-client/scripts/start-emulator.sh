#!/usr/bin/env bash
# Boot the Fluxion DPC test emulator (Google APIs image — required for
# Device Owner provisioning + FCM; Play Store images block set-device-owner).
# Creates the AVD on first run, then boots it and waits until ADB is ready.
#
# Env overrides:
#   ANDROID_HOME  (default: $HOME/Library/Android/sdk)
#   NO_COLOR      (set to any value to disable colors/animation)
set -euo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
AVD_NAME="fluxion-dpc"
SYSTEM_IMAGE="system-images;android-34;google_apis;arm64-v8a"
EMULATOR="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
EMU_LOG="/tmp/fluxion-emulator.log"

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
kv()   { printf '   %s%-8s%s %s\n' "$c_dim" "$1" "$c_reset" "$2"; }
info() { printf '  %s▸%s %s\n' "$c_c" "$c_reset" "$1"; }

# step "label" cmd args... — run cmd, animate a spinner with an elapsed timer,
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

# --- header + summary ---
printf '\n %s%sFluxion%s %s· start DPC emulator%s\n' "$c_b" "$c_mag" "$c_reset" "$c_dim" "$c_reset"
rule
kv "avd"   "$AVD_NAME"
kv "image" "$SYSTEM_IMAGE"
kv "sdk"   "$SDK"
rule

# --- tool checks ---
if [ ! -x "$EMULATOR" ]; then
  printf '  %s✘ emulator package missing%s\n' "$c_r" "$c_reset" >&2
  printf '     %sinstall: sdkmanager "emulator" "%s"%s\n' "$c_dim" "$SYSTEM_IMAGE" "$c_reset" >&2
  exit 1
fi
[ -x "$ADB" ]        || fail 1 "adb not found at $ADB (install platform-tools)"
[ -x "$AVDMANAGER" ] || fail 1 "avdmanager not found at $AVDMANAGER (install cmdline-tools)"

# --- ensure the AVD exists (create once) ---
if "$AVDMANAGER" list avd -c 2>/dev/null | grep -qx "$AVD_NAME"; then
  printf '  %s✔%s AVD %s%s%s ready\n' "$c_g" "$c_reset" "$c_b" "$AVD_NAME" "$c_reset"
else
  create_avd() { echo no | "$AVDMANAGER" create avd -n "$AVD_NAME" -k "$SYSTEM_IMAGE" -d pixel_6; }
  step "Creating AVD '$AVD_NAME'" create_avd || fail 1 "avdmanager create avd failed"
fi

# --- already running? ---
if "$ADB" devices | grep -q "^emulator-"; then
  printf '  %s✔%s an emulator is already running\n' "$c_g" "$c_reset"
  "$ADB" devices | sed -n 's/^/     /p'
  exit 0
fi

# --- boot (headed, fire-and-forget) ---
info "Booting ${c_b}${AVD_NAME}${c_reset} (headed) ${c_dim}→ log: ${EMU_LOG}${c_reset}"
nohup "$EMULATOR" -avd "$AVD_NAME" -no-snapshot-save >"$EMU_LOG" 2>&1 &

# --- wait for boot (wait-for-device + sys.boot_completed) ---
wait_for_boot() {
  "$ADB" wait-for-device
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 2
  done
}
step "Waiting for emulator to boot" wait_for_boot || fail 1 "emulator failed to boot (see $EMU_LOG)"

# --- done ---
printf '\n %s%s✓ emulator ready%s\n' "$c_b" "$c_g" "$c_reset"
rule
printf '   %snext%s  %s./gradlew :app:installDebug%s %s&&%s %s./scripts/adb-enroll.sh%s\n' \
  "$c_dim" "$c_reset" "$c_c" "$c_reset" "$c_dim" "$c_reset" "$c_c" "$c_reset"
printf '\n'
