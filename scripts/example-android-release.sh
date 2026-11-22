#!/bin/sh
# Pack the library into the example app and build, install and launch the
# Android release build on one device. The app runs every scenario once on
# launch and saves a report. Usage: sh scripts/example-android-release.sh <adb serial>
set -eu
SERIAL="${1:?usage: example-android-release.sh <adb serial>}"
npm run example:install >/dev/null
(cd example/android && timeout 3000 ./gradlew assembleRelease --console=plain -q)
timeout 180 adb -s "$SERIAL" install -r example/android/app/build/outputs/apk/release/app-release.apk
timeout 20 adb -s "$SERIAL" shell am force-stop com.jankscopeexample
timeout 20 adb -s "$SERIAL" logcat -c
timeout 20 adb -s "$SERIAL" shell am start -n com.jankscopeexample/.MainActivity
