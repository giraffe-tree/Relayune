package cn.giraffetree.relayune

import android.content.Intent
import android.content.ComponentCallbacks2
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.MessageDigest

class MainActivity : FlutterActivity() {
    private val updateChannel = "cn.giraffetree.relayune/android_update"
    private val notificationSettingsChannel =
        "cn.giraffetree.relayune/notification_settings"
    private val unknownSourcesRequest = 7401
    private var pendingInstall: Pair<File, MethodChannel.Result>? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger,
            "cn.giraffetree.relayune/client_identity").setMethodCallHandler { call, result ->
            if (call.method == "androidId") {
                result.success(Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID))
            } else result.notImplemented()
        }
        val pushChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger,
            "cn.giraffetree.relayune/push")
        RelayPush.channel = pushChannel
        pushChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "configure" -> {
                    RelayPush.configure(applicationContext, call.argument<Boolean>("enabled") == true)
                    result.success(null)
                }
                "registration" -> result.success(RelayPush.registration(applicationContext))
                "consented" -> result.success(RelayPush.consented(applicationContext))
                "consent" -> { RelayPush.consent(applicationContext); result.success(null) }
                "capabilities" -> result.success(mapOf("configured" to BuildConfig.JPUSH_CONFIGURED,
                    "vivoSceneConfigured" to BuildConfig.VIVO_ATOMIC_SCENE.isNotEmpty(),
                    "vivoSceneSupported" to VivoAtomicNotification.available(applicationContext)))
                else -> result.notImplemented()
            }
        }
        val liveTasks = LiveTaskNotifications(this)
        liveTasks.clearLegacyRunning()
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "cn.giraffetree.relayune/live_tasks",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "update" -> { (call.arguments as? Map<*, *>)?.let(liveTasks::update); result.success(null) }
                "clear" -> { liveTasks.clear(); result.success(null) }
                else -> result.notImplemented()
            }
        }

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            updateChannel,
        ).setMethodCallHandler(::handleUpdateMethod)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            notificationSettingsChannel,
        ).setMethodCallHandler { call, result ->
            if (call.method == "open") {
                openNotificationSettings(result)
            } else {
                result.notImplemented()
            }
        }
    }

    override fun onResume() { super.onResume(); RelayPush.foreground = true }
    override fun onPause() { RelayPush.foreground = false; super.onPause() }

    override fun onTrimMemory(level: Int) {
        Log.i("RelayuneLifecycle",
            "Relayune history performance {\"stage\":\"android_memory_trim\",\"trim_level\":$level}")
        // UI_HIDDEN means the screen went away, not that RAM is scarce. Flutter
        // 3.32 also turns this level into a Dart memory-pressure warning, which
        // would discard our five-minute warm history on an ordinary Home press.
        // Retain the renderer/platform-view trimming without that warning.
        if (level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            flutterEngine?.renderer?.onTrimMemory(level)
            flutterEngine?.platformViewsController?.onTrimMemory(level)
        } else {
            super.onTrimMemory(level)
        }
    }
    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        RelayPush.channel?.setMethodCallHandler(null)
        RelayPush.channel = null
        super.cleanUpFlutterEngine(flutterEngine)
    }

    private fun openNotificationSettings(result: MethodChannel.Result) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        }
        try {
            startActivity(intent)
            result.success(null)
        } catch (error: Exception) {
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:$packageName"),
                    ),
                )
                result.success(null)
            } catch (fallbackError: Exception) {
                result.error(
                    "settings_unavailable",
                    fallbackError.message,
                    null,
                )
            }
        }
    }

    private fun handleUpdateMethod(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "environment" -> {
                val updateCache = File(cacheDir, "updates").apply { mkdirs() }
                val updateState = File(File(filesDir, "updates").apply { mkdirs() }, "state.json")
                val packageInfo = packageManager.getPackageInfo(packageName, 0)
                val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    packageInfo.longVersionCode.toInt()
                } else {
                    @Suppress("DEPRECATION")
                    packageInfo.versionCode
                }
                result.success(
                    mapOf(
                        "version_code" to versionCode,
                        "state_path" to updateState.absolutePath,
                        "download_directory" to updateCache.absolutePath,
                    ),
                )
            }
            "install" -> installUpdate(call, result)
            else -> result.notImplemented()
        }
    }

    private fun installUpdate(call: MethodCall, result: MethodChannel.Result) {
        if (pendingInstall != null) {
            result.error("install_in_progress", "An update install is already in progress.", null)
            return
        }
        val requestedPath = call.argument<String>("apk_path")
        if (requestedPath.isNullOrBlank()) {
            result.error("invalid_apk", "The APK path is missing.", null)
            return
        }
        val updateRoot: File
        val apk: File
        try {
            updateRoot = File(cacheDir, "updates").canonicalFile
            apk = File(requestedPath).canonicalFile
        } catch (error: Exception) {
            result.error("invalid_apk", "The APK path could not be resolved.", null)
            return
        }
        val insideUpdateRoot = apk.parentFile == updateRoot
        if (!insideUpdateRoot || apk.extension.lowercase() != "apk" || !apk.isFile) {
            result.error("invalid_apk", "The APK is outside the private update cache.", null)
            return
        }
        val validationError = validateArchive(apk)
        if (validationError != null) {
            result.error("untrusted_apk", validationError, null)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !packageManager.canRequestPackageInstalls()
        ) {
            pendingInstall = apk to result
            val permissionIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:$packageName"),
            )
            try {
                startActivityForResult(permissionIntent, unknownSourcesRequest)
            } catch (error: Exception) {
                pendingInstall = null
                result.error(
                    "install_permission_unavailable",
                    "Android could not open the install permission settings.",
                    null,
                )
            }
            return
        }
        openPackageInstaller(apk, result)
    }

    private fun validateArchive(apk: File): String? {
        return try {
            val signatureFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageManager.GET_SIGNING_CERTIFICATES
            } else {
                @Suppress("DEPRECATION")
                PackageManager.GET_SIGNATURES
            }
            val archive = packageManager.getPackageArchiveInfo(apk.path, signatureFlags)
                ?: return "The downloaded file is not a readable Android package."
            val installed = packageManager.getPackageInfo(packageName, signatureFlags)
            if (archive.packageName != packageName) {
                return "The downloaded package name does not match Relayune."
            }
            if (longVersionCode(archive) <= longVersionCode(installed)) {
                return "The downloaded package is not newer than this Relayune version."
            }
            val archiveSigners = signerSha256(archive)
            val installedSigners = signerSha256(installed)
            if (archiveSigners.isEmpty() || archiveSigners != installedSigners) {
                return "The downloaded package signature does not match Relayune."
            }
            null
        } catch (error: Exception) {
            "The downloaded package could not be authenticated."
        }
    }

    private fun longVersionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }

    private fun signerSha256(info: PackageInfo): Set<String> {
        val signatures: Array<Signature> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners ?: emptyArray()
        } else {
            @Suppress("DEPRECATION")
            info.signatures ?: emptyArray()
        }
        return signatures.mapTo(mutableSetOf()) { signature ->
            MessageDigest.getInstance("SHA-256")
                .digest(signature.toByteArray())
                .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
        }
    }

    private fun openPackageInstaller(apk: File, result: MethodChannel.Result) {
        try {
            val apkUri = FileProvider.getUriForFile(
                this,
                "$packageName.update_files",
                apk,
            )
            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                },
            )
            result.success(null)
        } catch (error: Exception) {
            result.error("installer_unavailable", error.message, null)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != unknownSourcesRequest) return
        val pending = pendingInstall ?: return
        pendingInstall = null
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            packageManager.canRequestPackageInstalls()
        ) {
            val validationError = validateArchive(pending.first)
            if (validationError == null) {
                openPackageInstaller(pending.first, pending.second)
            } else {
                pending.second.error("untrusted_apk", validationError, null)
            }
        } else {
            pending.second.error(
                "install_permission_denied",
                "Permission to install updates was not granted.",
                null,
            )
        }
    }
}
