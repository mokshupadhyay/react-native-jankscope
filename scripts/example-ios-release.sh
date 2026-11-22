#!/bin/sh
# Pack the library into the example app, build the Release configuration for
# the simulator, install it and launch it. The app runs every scenario once on
# launch and saves a report. Usage: sh scripts/example-ios-release.sh <simulator udid>
set -eu
UDID="${1:?usage: example-ios-release.sh <simulator udid>}"
BUNDLE_ID=org.reactjs.native.example.JankscopeExample
npm run example:install >/dev/null
(cd example/ios && timeout 1800 pod install >/dev/null)
(cd example/ios && timeout 3600 xcodebuild -workspace JankscopeExample.xcworkspace -scheme JankscopeExample \
  -configuration Release -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath build -quiet)
timeout 120 xcrun simctl install "$UDID" example/ios/build/Build/Products/Release-iphonesimulator/JankscopeExample.app
timeout 30 xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
timeout 30 xcrun simctl launch "$UDID" "$BUNDLE_ID"
