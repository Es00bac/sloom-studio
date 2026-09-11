#!/usr/bin/env bash
# Sideload the latest debug APK to the connected device (USB or wireless ADB).
#
# Wireless: the device must be reachable from this machine. The IP:port comes from
# the phone's Settings -> Developer options -> Wireless debugging screen (it can change
# when toggled). Override with: WIRELESS=<ip:port> scripts/sideload-latest.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
WIRELESS="${WIRELESS:-172.18.11.218:41261}"

if [ ! -f "$APK" ]; then
  echo "APK not found: $APK"
  echo "Build it first:  npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)"
  exit 1
fi

# Try the wireless endpoint (device is already paired with this machine); ignore failure.
adb connect "$WIRELESS" >/dev/null 2>&1 || true

SERIALS="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
if [ -z "$SERIALS" ]; then
  echo "No ADB device connected (USB or wireless)."
  echo "  - Plug in USB, OR"
  echo "  - Check the phone's Wireless debugging IP:port and run: WIRELESS=<ip:port> $0"
  exit 2
fi

STATUS=0
for SERIAL in $SERIALS; do
  echo "Installing $APK -> $SERIAL"
  if adb -s "$SERIAL" install -r "$APK"; then
    echo "  installed on $SERIAL"
  else
    echo "  FAILED on $SERIAL"
    STATUS=1
  fi
done
exit "$STATUS"
