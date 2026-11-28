# Streambert for Android

The Android TV and phone app connects to a running Streambert web server. Stream resolution and ad blocking run on that server.

## Install and connect

1. Find the most recent release with a `Streambert-Android-<tag>.apk` asset on the [GitHub releases page](https://github.com/Awu05/streambert/releases).
2. Open the APK on your phone or sideload it on Android TV. On a Shield you can use a downloader app or enable network debugging and run `adb connect <shield-ip>:5555` followed by `adb install -r <path-to-apk>`.
3. Open Streambert and enter the address of your [Streambert web server](../docker/README.md), such as `http://192.168.1.5:8080`. After connecting, sign in with your server password and select a profile. Update the server to a version that includes Android support for the native Back and Settings integration.
4. On Android TV, enable **TV remote / keyboard navigation** in Streambert’s interface settings. Press Back to close the current dialog, player, or page.

You can change the server and check for updates under **Settings → Android app**. From sign-in, press Back to reach the native dialog and choose **Change server**. The app checks GitHub automatically on startup and after returning to the foreground when the last check was over 24 hours ago. Android asks you to allow Streambert to install apps the first time you update, then shows its install confirmation.

## Build with Docker

From the repository root, run this command in PowerShell with Docker Desktop running.

```powershell
docker run --rm -v "${PWD}/android:/workspace" -v streambert-gradle:/root/.gradle -w /workspace ghcr.io/cirruslabs/android-sdk:35 bash gradlew --no-daemon testDebugUnitTest assembleDebug
```

The debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. It installs alongside the release app.

## Release signing

Generate the release key once. Run this interactive command in PowerShell and enter the passwords at the prompts.

```powershell
$keyDir = Join-Path $env:USERPROFILE '.streambert-android'
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
docker run --rm -it -v "${keyDir}:/keys" eclipse-temurin:17-jdk keytool -genkeypair -v -keystore /keys/release.jks -storetype PKCS12 -alias streambert -keyalg RSA -keysize 4096 -validity 36500
```

Set these GitHub Actions secrets on `Awu05/streambert`. Run the last three commands without passing the values on the command line. Use `streambert` for the alias and the same value for both password secrets if you used the command above.

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $keyDir 'release.jks'))) | gh secret set ANDROID_KEYSTORE_BASE64 -R Awu05/streambert
gh secret set ANDROID_KEYSTORE_PASSWORD -R Awu05/streambert
gh secret set ANDROID_KEY_ALIAS -R Awu05/streambert
gh secret set ANDROID_KEY_PASSWORD -R Awu05/streambert
```

Back up the keystore and passwords. Android requires the same signing key for every upgrade.

For a local signed build, set `STREAMBERT_KEYSTORE`, `STREAMBERT_KEYSTORE_PASSWORD`, `STREAMBERT_KEY_ALIAS`, and `STREAMBERT_KEY_PASSWORD` in the build environment. Alternatively, put `storeFile`, `storePassword`, `keyAlias`, and `keyPassword` in the ignored `android/keystore.properties`. The keystore path must be visible to Gradle. Run `./gradlew assembleRelease -PappVersion=2.16.0` from `android/`, substituting the release version.

The GitHub workflow builds and attaches a signed APK on a new version tag when `android/` differs from the latest release with a published APK. If a build or upload fails, the next eligible tag still includes those changes. To rebuild the APK for an existing release, run **Android app** from the Actions tab, enter the release tag, and select **force**.
