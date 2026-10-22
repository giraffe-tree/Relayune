import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Public client parameters are injected locally; server MasterSecret is never an APK input.
val pushProperties = Properties().apply {
    rootProject.file("push.local.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}
fun pushValue(name: String): String = System.getenv(name) ?: pushProperties.getProperty(name, "")
val jpushAppKey = pushValue("JPUSH_APPKEY")
val vivoReady = pushValue("VIVO_APPID").matches(Regex("[0-9]+")) &&
    pushValue("VIVO_APPKEY").isNotBlank()
val vivoScene = pushValue("VIVO_ATOMIC_SCENE")
require(vivoScene.isEmpty() || vivoScene.matches(Regex("[A-Z][A-Z0-9_]{1,63}"))) {
    "VIVO_ATOMIC_SCENE must be the scene approved by vivo."
}

val signingStoreFile = System.getenv("ANDROID_SIGNING_STORE_FILE")
val signingStorePassword = System.getenv("ANDROID_SIGNING_STORE_PASSWORD")
val signingKeyAlias = System.getenv("ANDROID_SIGNING_KEY_ALIAS")
val signingKeyPassword = System.getenv("ANDROID_SIGNING_KEY_PASSWORD")
val releaseSigningReady = listOf(
    signingStoreFile,
    signingStorePassword,
    signingKeyAlias,
    signingKeyPassword,
).all { !it.isNullOrBlank() }
val releaseBuildRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}

if (releaseBuildRequested && !releaseSigningReady) {
    throw GradleException(
        "Release signing is required. Run the build through the " +
            "manage-android-signing-keys skill.",
    )
}

android {
    namespace = "cn.giraffetree.relayune"
    compileSdk = flutter.compileSdkVersion
    // Native plugin floor (app_links, secure storage and path provider).
    ndkVersion = "27.0.12077973"

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Unit tests exercise our Bundle/consent logic; vendor SDKs run on the device.
    testOptions { unitTests.isIncludeAndroidResources = false }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    buildFeatures { buildConfig = true }

    defaultConfig {
        applicationId = "cn.giraffetree.relayune"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["JPUSH_PKGNAME"] = applicationId!!
        manifestPlaceholders["JPUSH_APPKEY"] = jpushAppKey.ifEmpty { "000000000000000000000000" }
        manifestPlaceholders["JPUSH_CHANNEL"] = "relayune"
        manifestPlaceholders["VIVO_APPID"] = pushValue("VIVO_APPID").ifEmpty { "0" }
        manifestPlaceholders["VIVO_APPKEY"] = pushValue("VIVO_APPKEY").ifEmpty { "unconfigured" }
        buildConfigField("boolean", "JPUSH_CONFIGURED", jpushAppKey.matches(Regex("[a-fA-F0-9]{24}")).toString())
        buildConfigField("String", "VIVO_ATOMIC_SCENE", "\"$vivoScene\"")
    }

    signingConfigs {
        create("release") {
            if (releaseSigningReady) {
                storeFile = file(signingStoreFile!!)
                storePassword = signingStorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    implementation("androidx.core:core-ktx:1.13.1")
    // Versions match the SDK supplied by the user. Pin JCore's otherwise dynamic dependency.
    implementation("cn.jiguang.sdk:jpush:6.2.1")
    implementation("cn.jiguang.sdk:jcore:5.5.1") { version { strictly("5.5.1") } }
    if (vivoReady) implementation("cn.jiguang.sdk.plugin:vivo:6.2.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}

flutter {
    source = "../.."
}
