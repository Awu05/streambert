import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun versionCodeFor(version: String): Int {
    val match = Regex("""(\d+)\.(\d{1,2})\.(\d{1,2})""").matchEntire(version)
        ?: throw GradleException("appVersion must be X.Y.Z with minor and patch between 0 and 99")
    val (major, minor, patch) = match.destructured
    val code = (major.toLongOrNull() ?: throw GradleException("Invalid appVersion: $version"))
        .takeIf { it <= 210_000 }
        ?.let { it * 10_000 + minor.toInt() * 100 + patch.toInt() }
    if (code == null || code > 2_100_000_000) {
        throw GradleException("appVersion exceeds the supported versionCode range: $version")
    }
    return code.toInt().coerceAtLeast(1)
}

val appVersion = providers.gradleProperty("appVersion").orElse("0.0.0").get()
val localSigning = Properties().apply {
    rootProject.file("keystore.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}
fun signingValue(env: String, property: String): String? =
    providers.environmentVariable(env).orNull ?: localSigning.getProperty(property)

val releaseStore = signingValue("STREAMBERT_KEYSTORE", "storeFile")
val releaseStorePassword = signingValue("STREAMBERT_KEYSTORE_PASSWORD", "storePassword")
val releaseAlias = signingValue("STREAMBERT_KEY_ALIAS", "keyAlias")
val releaseKeyPassword = signingValue("STREAMBERT_KEY_PASSWORD", "keyPassword")
val releaseSigningConfigured = listOf(releaseStore, releaseStorePassword, releaseAlias, releaseKeyPassword)
    .all { !it.isNullOrBlank() }

android {
    namespace = "com.awu05.streambert"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.awu05.streambert"
        minSdk = 26
        targetSdk = 35
        versionName = appVersion
        versionCode = versionCodeFor(appVersion)
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = rootProject.file(checkNotNull(releaseStore))
                storePassword = releaseStorePassword
                keyAlias = releaseAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            resValue("string", "app_name", "Streambert (debug)")
        }
        release {
            resValue("string", "app_name", "Streambert")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

if (!releaseSigningConfigured) {
    val requireReleaseSigning by tasks.registering {
        doLast { throw GradleException("Release signing is not configured") }
    }
    tasks.configureEach {
        if (name == "packageRelease" || name == "packageReleaseBundle") dependsOn(requireReleaseSigning)
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
