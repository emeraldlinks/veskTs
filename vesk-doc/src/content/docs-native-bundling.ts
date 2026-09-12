export type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "code"; filename: string; language?: string; code: string }
  | { kind: "tabs"; tabs: { label: string; filename: string; code: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export const pages: { slug: string; title: string; description: string; group: string; blocks: Block[] }[] = [
  {
    slug: "native-bundling",
    title: "Native Signing & Bundling",
    description:
      "Release signing and packaging for Android (AAB + APK) and iOS (Xcode project + .ipa): signing config, pre-flight checks, secrets via env:, export methods, and Play/App Store requirements.",
    group: "Native",
    blocks: [
      {
        kind: "p",
        text: "`vesk-native bundle` produces the release artifacts for both platforms. Android builds AAB + release APK; iOS regenerates the Xcode project, archives, and exports an .ipa. Signing is configured in `veskconfig.ts` and pre-flighted before anything is built.",
      },
      { kind: "h2", text: "Requirement summaries" },
      {
        kind: "table",
        head: ["Platform", "Requirements"],
        rows: [
          ["Android", "Upload-key keystore (.jks/.keystore), RSA ≥ 2048 bits, certificate validity ending after 2033-10-22. AAB is mandatory for new Play apps since Aug 2021."],
          ["iOS", "macOS + Xcode 26+ (required for App Store Connect uploads since 2026-04-28), Apple Developer team, distribution certificate + provisioning profile (manual) or Xcode-managed signing (automatic). No bitcode (dead since Xcode 14)."],
        ],
      },
      { kind: "h2", text: "Android signing config" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  signing: {
    android: {
      storeFile: 'keystore.jks',
      storePassword: 'env:KEYSTORE_PASSWORD',
      keyAlias: 'upload',
      keyPassword: 'env:KEY_PASSWORD',
    },
  },
  bundle: {
    android: ['aab', 'apk'],
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`storeFile` — absolute or app-relative path to the upload-key keystore.",
          "Passwords reference environment variables as `env:NAME` strings — never plain values, so secrets never land in generated build files.",
          "No signing config → release artifacts are signed with the debug keystore. This is the dev flow only and is not for store distribution.",
          "Unknown `bundle.android` members are rejected up-front.",
        ],
      },
      { kind: "h2", text: "Android pre-flight checks" },
      {
        kind: "p",
        text: "Before building release artifacts, `androidSigningChecks` runs:",
      },
      {
        kind: "list",
        items: [
          "storeFile/storePassword/keyAlias/keyPassword present (or debug-keystore fallback accepted).",
          "`env:NAME` values resolve from the environment.",
          "`keytool -list -v` inspects the keystore/alias — wrong storepass or missing alias fails.",
          "RSA keys under 2048 bits produce a warning (Play rejects them).",
          "Certificates expiring on or before 2033-10-22 warn — keep validity well past that date.",
        ],
      },
      { kind: "h2", text: "Android bundle output" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `vesk-native bundle          # android (default)

# Outputs:
# app/build/outputs/bundle/release/app-release.aab
# app/build/outputs/apk/release/app-release.apk`,
      },
      {
        kind: "list",
        items: [
          "`.aab` — Android App Bundle, required by Google Play (Play App Signing).",
          "`.apk` — standalone release APK for sideloading.",
          "Targets come from `bundle.android` (default `['aab', 'apk']`).",
        ],
      },
      { kind: "h2", text: "iOS signing config" },
      {
        kind: "code",
        filename: "veskconfig.ts",
        language: "typescript",
        code: `export default defineConfig({
  signing: {
    ios: {
      teamId: 'A1B2C3D4E5',
      style: 'automatic',           // 'automatic' | 'manual'
      appStoreConnectApiKey: {      // automatic on CI
        keyPath: 'keys/api.p8',
        keyId: 'ABC123DEF4',
        issuerId: '69a6de90-...',
      },
    },
  },
})`,
      },
      {
        kind: "list",
        items: [
          "`teamId` — the 10-character Apple Developer team id (DEVELOPMENT_TEAM).",
          "`style: 'automatic'` — Xcode-managed profiles with `-allowProvisioningUpdates`; add an App Store Connect API key for unattended CI.",
          "`style: 'manual'` — explicit distribution certificate (`.p12`, password as `env:NAME`), provisioning profile name/UUID, or a `profilesDir` scanned by bundle id.",
        ],
      },
      { kind: "h2", text: "iOS bundle flow" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `vesk-native bundle ios`,
      },
      {
        kind: "list",
        items: [
          "1. `requireIosSigning` — validates teamId format (`[A-Z0-9]{10}`), cert/profile presence for manual style, `env:` resolution, darwin host, xcodebuild, and the bundle method.",
          "2. Regenerates the Xcode project at `ios/VeskApp.xcodeproj` (deployment target 17.0, AppIcon 1024x1024 from `icon.foreground` or `assets/icon.png`, Info.plist privacy strings pruned from device-API usage).",
          "3. `xcodebuild archive` — scheme default `VeskApp`, Release, generic iOS destination.",
          "4. Reads the embedded provisioning-profile UUID out of the fresh archive (never a stale config) and stages it into `~/Library/MobileDevice/Provisioning Profiles`.",
          "5. Writes `ExportOptions.plist` via `iosExportOptions` — method from `bundle.ios.method`.",
          "6. `xcodebuild -exportArchive` — manual style imports the cert into `vesk-build.keychain`; automatic passes `-allowProvisioningUpdates` plus ASC API key args when configured.",
          "7. Output: `VeskApp.ipa` under the ios export directory.",
        ],
      },
      { kind: "h2", text: "iOS export options" },
      {
        kind: "table",
        head: ["Option", "Type", "Description"],
        rows: [
          ["method", "'app-store-connect' | 'ad-hoc' | 'development' | 'enterprise'", "App Store + TestFlight / registered devices / debug installs / in-house (enterprise program)."],
          ["destination", "'export' | 'upload'", "Write the .ipa locally, or let Xcode push it to App Store Connect via the REST flow."],
          ["uploadSymbols", "boolean (default true)", "Include dSYMs in the .ipa for symbolication."],
          ["scheme", "string (default VeskApp)", "Xcode 26+ scheme for archive/export."],
        ],
      },
      { kind: "h2", text: "vesk-native verify bundle" },
      {
        kind: "code",
        filename: "terminal",
        language: "text",
        code: `vesk-native verify bundle            # all platforms
vesk-native verify bundle android
vesk-native verify bundle ios`,
      },
      {
        kind: "list",
        items: [
          "Read-only. Runs every pre-flight check for the platform(s) without building anything.",
          "Prints PASS/WARN/FAIL per check; exits non-zero when any check FAILs.",
          "Ideal for CI gating before a release.",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text: "The iOS path requires macOS with Xcode installed. App Store Connect uploads must be built with Xcode 26+ and the iOS 26 SDK since April 28, 2026 — the CLI warns when Xcode is older. Bitcode is not offered (dead since Xcode 14).",
      },
      {
        kind: "note",
        tone: "info",
        text: "Debug APKs from `vesk-native build` are unsigned-with-debug-keystore automatically; no signing config is required for development.",
      },
    ],
  },
];