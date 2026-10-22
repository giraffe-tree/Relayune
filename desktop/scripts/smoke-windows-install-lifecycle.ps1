param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerDirectory,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [string]$ProductName = "Relayune",

  [Parameter(Mandatory = $true)]
  [string]$Publisher,

  [string]$BundleIdentifier = "cn.giraffetree.agent-relay",

  [string]$BaselineInstallerDirectory,

  [string]$ExpectedBaselineVersion,

  [Parameter(Mandatory = $true)]
  [string]$CurrentGuiSource,

  [Parameter(Mandatory = $true)]
  [string]$CurrentSidecarSource,

  [ValidateSet("system", "en", "zh-CN")]
  [string]$ExpectedUiLanguage = "system"
)

$ErrorActionPreference = "Stop"
$uninstallRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
$installer = $null
$uninstaller = $null
$primary = $null
$secondary = $null
$reopen = $null
$startupRecoveryReopen = $null
$defaultConfigProbe = $null
$pairingFailureStub = $null
$testMutationStarted = $false
$lifecycleCompleted = $false
$lifecycleError = $null
$cleanupErrors = [System.Collections.Generic.List[string]]::new()
$inheritedTestMode = [Environment]::GetEnvironmentVariable("AGENT_RELAY_TEST_MODE", "Process")
$inheritedTestConfigPath = [Environment]::GetEnvironmentVariable("AGENT_RELAY_CONFIG_PATH", "Process")

if (
  [string]::IsNullOrWhiteSpace($env:APPDATA) -or
  [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -or
  [string]::IsNullOrWhiteSpace($env:SystemRoot)
) {
  throw "APPDATA, LOCALAPPDATA, and SystemRoot are required for the Windows lifecycle smoke."
}
if ($null -ne $inheritedTestMode -or $null -ne $inheritedTestConfigPath) {
  throw "Windows lifecycle requires the installed app's real default config path; refusing inherited test overrides."
}
if ([string]::IsNullOrWhiteSpace($ProductName) -or $ProductName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
  throw "ProductName is not safe for an exact test installation path."
}
if ([string]::IsNullOrWhiteSpace($Publisher) -or $Publisher.Contains("\")) {
  throw "Publisher is not safe for an exact test registry path."
}
if ($BundleIdentifier -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]+$') {
  throw "BundleIdentifier is not safe for an exact test data path."
}
$hasUpgradeBaseline = -not [string]::IsNullOrWhiteSpace($BaselineInstallerDirectory)
if ($hasUpgradeBaseline -ne (-not [string]::IsNullOrWhiteSpace($ExpectedBaselineVersion))) {
  throw "BaselineInstallerDirectory and ExpectedBaselineVersion must be provided together."
}
if ($hasUpgradeBaseline) {
  $baselineVersion = [System.Management.Automation.SemanticVersion]$ExpectedBaselineVersion
  $currentVersion = [System.Management.Automation.SemanticVersion]$ExpectedVersion
  if ($baselineVersion -ge $currentVersion) {
    throw "The synthetic baseline version must be older than the current installer version."
  }
}
$expectedUninstallKey = Join-Path $uninstallRegistryPath $ProductName
$manufacturerProductKey = "HKCU:\Software\$Publisher\$ProductName"
$expectedInstallDirectory = Join-Path $env:LOCALAPPDATA $ProductName
$appDataDirectory = Join-Path $env:APPDATA $BundleIdentifier
$webViewDataDirectory = Join-Path $env:LOCALAPPDATA $BundleIdentifier
$testConfigDirectory = $appDataDirectory
$testConfigPath = Join-Path $testConfigDirectory "config.json"
$testStatePath = Join-Path $testConfigDirectory "relay-outbox.json"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "$ProductName.lnk"
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "$ProductName.lnk"
$autostartRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$startupApprovedRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
$cleanShellWorkingDirectory = Join-Path $env:SystemRoot "System32"
$cleanLaunchPath = @(
  $cleanShellWorkingDirectory,
  $env:SystemRoot,
  (Join-Path $env:SystemRoot "System32\Wbem"),
  (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0")
) -join ";"
$startupApprovedKeyExisted = Test-Path -LiteralPath $startupApprovedRegistryPath
$enabledStartupApproval = [byte[]]@(0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)
$upgradeSentinel = Join-Path $appDataDirectory ".relayune-ci-upgrade-sentinel"
$appDataRetentionSentinel = Join-Path $appDataDirectory ".relayune-ci-uninstall-retention"
$webViewRetentionSentinel = Join-Path $webViewDataDirectory ".relayune-ci-uninstall-retention"
$retentionMarker = "relayune-ci-retain-$ExpectedVersion"
$expectedProductionServerUrl = "https://relayune.giraffetree.cn"

if (-not ("RelayuneWindowProbe" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class RelayuneWindowProbe {
  private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr window);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);

  [DllImport("user32.dll")]
  private static extern int GetWindowTextLength(IntPtr window);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool AreDpiAwarenessContextsEqual(IntPtr contextA, IntPtr contextB);

  [DllImport("kernel32.dll", EntryPoint = "GetUserPreferredUILanguages", ExactSpelling = true, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetUserPreferredUILanguagesLength(
    uint flags,
    out uint languageCount,
    IntPtr buffer,
    ref uint bufferLength
  );

  [DllImport("kernel32.dll", EntryPoint = "GetUserPreferredUILanguages", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetUserPreferredUILanguagesBuffer(
    uint flags,
    out uint languageCount,
    [Out] char[] buffer,
    ref uint bufferLength
  );

  public static IntPtr[] VisibleWindows(uint processId) {
    var windows = new List<IntPtr>();
    var enumerated = EnumWindows((window, parameter) => {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner == processId && IsWindowVisible(window)) {
        windows.Add(window);
      }
      return true;
    }, IntPtr.Zero);
    if (!enumerated) {
      throw new InvalidOperationException("EnumWindows failed with Win32 error " + Marshal.GetLastWin32Error());
    }
    return windows.ToArray();
  }

  public static string WindowTitle(IntPtr window) {
    var text = new StringBuilder(GetWindowTextLength(window) + 1);
    GetWindowText(window, text, text.Capacity);
    return text.ToString();
  }

  public static uint ForegroundProcessId() {
    var window = GetForegroundWindow();
    if (window == IntPtr.Zero) {
      return 0;
    }
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return processId;
  }

  public static bool CloseWindow(IntPtr window) {
    const uint WM_CLOSE = 0x0010;
    return PostMessage(window, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
  }

  public static bool IsPerMonitorV2(IntPtr window) {
    var context = GetWindowDpiAwarenessContext(window);
    var perMonitorV2 = new IntPtr(-4);
    return context != IntPtr.Zero && AreDpiAwarenessContextsEqual(context, perMonitorV2);
  }

  public static string PreferredUiLanguage() {
    const uint MUI_LANGUAGE_NAME = 0x8;
    uint languageCount;
    uint bufferLength = 0;
    if (!GetUserPreferredUILanguagesLength(
      MUI_LANGUAGE_NAME,
      out languageCount,
      IntPtr.Zero,
      ref bufferLength
    ) || languageCount == 0 || bufferLength < 2) {
      throw new InvalidOperationException(
        "GetUserPreferredUILanguages length query failed with Win32 error " + Marshal.GetLastWin32Error()
      );
    }
    var buffer = new char[bufferLength];
    if (!GetUserPreferredUILanguagesBuffer(
      MUI_LANGUAGE_NAME,
      out languageCount,
      buffer,
      ref bufferLength
    )) {
      throw new InvalidOperationException(
        "GetUserPreferredUILanguages buffer query failed with Win32 error " + Marshal.GetLastWin32Error()
      );
    }
    var firstLength = Array.IndexOf(buffer, '\0');
    if (firstLength <= 0) {
      throw new InvalidOperationException("GetUserPreferredUILanguages returned no usable language name.");
    }
    return new string(buffer, 0, firstLength);
  }
}
'@
}

$systemUiCultureName = [RelayuneWindowProbe]::PreferredUiLanguage()
$expectedUiLanguageCode = if ($ExpectedUiLanguage -eq "system") {
  if ($systemUiCultureName.StartsWith("zh", [StringComparison]::OrdinalIgnoreCase)) { "zh-CN" } else { "en" }
} else {
  $ExpectedUiLanguage
}
$startupFallbackUiLanguageCode = if (
  $systemUiCultureName.StartsWith("zh", [StringComparison]::OrdinalIgnoreCase)
) { "zh-CN" } else { "en" }
$persistedUiLanguage = if ($ExpectedUiLanguage -eq "system") { $null } else { $ExpectedUiLanguage }

if (-not ("System.Windows.Automation.AutomationElement" -as [type])) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
}

if (-not ("RelayunePairingFailureStub" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public sealed class RelayunePairingFailureStub : IDisposable {
  private readonly TcpListener listener;
  private readonly Thread worker;
  private readonly object clientGate = new object();
  private TcpClient activeClient;
  private int requestCount;
  private volatile bool stopping;

  public RelayunePairingFailureStub() {
    listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    worker = new Thread(Serve) {
      IsBackground = true,
      Name = "Relayune Windows lifecycle loopback stub"
    };
    worker.Start();
  }

  public int Port {
    get { return ((IPEndPoint)listener.LocalEndpoint).Port; }
  }

  public int RequestCount {
    get { return Volatile.Read(ref requestCount); }
  }

  private void Serve() {
    while (!stopping) {
      TcpClient client = null;
      try {
        client = listener.AcceptTcpClient();
        lock (clientGate) {
          if (stopping) {
            client.Dispose();
            return;
          }
          activeClient = client;
        }
        using (client) {
          client.ReceiveTimeout = 5000;
          client.SendTimeout = 5000;
          using (var stream = client.GetStream()) {
            if (!DiscardExpectedPairingStartHeaders(stream)) {
              continue;
            }
            Interlocked.Increment(ref requestCount);
            const string body = "{\"error\":{\"code\":\"service_unavailable\"}}";
            var response = Encoding.ASCII.GetBytes(
              "HTTP/1.1 503 Service Unavailable\r\n" +
              "Content-Type: application/json\r\n" +
              "Cache-Control: no-store\r\n" +
              "Connection: close\r\n" +
              "Content-Length: " + Encoding.ASCII.GetByteCount(body) + "\r\n\r\n" +
              body
            );
            stream.Write(response, 0, response.Length);
            stream.Flush();
          }
        }
      } catch (SocketException) {
        if (!stopping) {
          Thread.Sleep(25);
        }
      } catch (IOException) {
        if (!stopping) {
          Thread.Sleep(25);
        }
      } catch (ObjectDisposedException) {
        if (!stopping) {
          Thread.Sleep(25);
        }
      } finally {
        lock (clientGate) {
          if (Object.ReferenceEquals(activeClient, client)) {
            activeClient = null;
          }
        }
      }
    }
  }

  private static bool DiscardExpectedPairingStartHeaders(NetworkStream stream) {
    // Deliberately retain no request data. Stop at the header terminator so the
    // pairing JSON body, short code and tokens are never read by the probe.
    var expectedRequestLine = Encoding.ASCII.GetBytes("POST /api/pairings/start HTTP/1.1\r\n");
    var terminatorOffset = 0;
    for (var total = 0; total < 16384; total++) {
      var value = stream.ReadByte();
      if (value < 0) {
        return false;
      }
      if (total < expectedRequestLine.Length && value != expectedRequestLine[total]) {
        return false;
      }
      switch (terminatorOffset) {
        case 0: terminatorOffset = value == '\r' ? 1 : 0; break;
        case 1: terminatorOffset = value == '\n' ? 2 : (value == '\r' ? 1 : 0); break;
        case 2: terminatorOffset = value == '\r' ? 3 : 0; break;
        case 3:
          if (value == '\n') {
            return true;
          }
          terminatorOffset = 0;
          break;
      }
    }
    return false;
  }

  public void Dispose() {
    if (stopping) {
      return;
    }
    stopping = true;
    listener.Stop();
    lock (clientGate) {
      if (activeClient != null) {
        activeClient.Dispose();
      }
    }
    if (!worker.Join(5000)) {
      throw new InvalidOperationException("The loopback pairing stub worker did not stop.");
    }
  }
}
'@
}

function Get-RelayuneInstallEntry {
  if (-not (Test-Path -LiteralPath $uninstallRegistryPath)) {
    return $null
  }
  $entries = @(
    Get-ChildItem -LiteralPath $uninstallRegistryPath -ErrorAction Stop |
      ForEach-Object {
        $uninstallKey = $_
        try {
          Get-ItemProperty -LiteralPath $uninstallKey.PSPath -ErrorAction Stop
        } catch {
          throw "Could not inspect uninstall registry entry $($uninstallKey.PSChildName): $($_.Exception.Message)"
        }
      } |
      Where-Object { $_.DisplayName -eq $ProductName }
  )
  if ($entries.Count -gt 1) {
    throw "Expected at most one $ProductName uninstall entry, found $($entries.Count)."
  }
  return $entries | Select-Object -First 1
}

function Get-ExecutableFromCommand {
  param([Parameter(Mandatory = $true)][string]$Command)
  if ($Command -match '^\s*"([^"]+\.exe)"') {
    return $Matches[1]
  }
  if ($Command -match '^\s*([^\s]+\.exe)') {
    return $Matches[1]
  }
  throw "Could not resolve an executable from uninstall command."
}

function Get-SoleInstaller {
  param([Parameter(Mandatory = $true)][string]$Directory)
  $installers = @(Get-ChildItem -LiteralPath $Directory -Filter "*.exe" -File)
  if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS installer in $Directory, found $($installers.Count)."
  }
  return $installers[0]
}

function Invoke-SilentInstaller {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string[]]$Arguments = @("/S")
  )
  $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "Silent NSIS invocation failed with exit code $($process.ExitCode)."
  }
}

function Wait-ForInstallEntry {
  param([Parameter(Mandatory = $true)][bool]$Present)
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $entry = Get-RelayuneInstallEntry
    if (($Present -and $null -ne $entry) -or (-not $Present -and $null -eq $entry)) {
      return $entry
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for the $ProductName uninstall entry (present=$Present)."
}

function Get-ShortcutLayout {
  param([Parameter(Mandatory = $true)][string]$Path)
  $linkShell = $null
  $shortcut = $null
  $propertyShell = $null
  $propertyFolder = $null
  $propertyItem = $null
  try {
    $linkShell = New-Object -ComObject WScript.Shell
    $shortcut = $linkShell.CreateShortcut($Path)
    $propertyShell = New-Object -ComObject Shell.Application
    $propertyFolder = $propertyShell.Namespace((Split-Path -Parent $Path))
    if ($null -eq $propertyFolder) {
      throw "Windows Shell could not open the installed shortcut directory."
    }
    $propertyItem = $propertyFolder.ParseName((Split-Path -Leaf $Path))
    if ($null -eq $propertyItem) {
      throw "Windows Shell could not parse the installed shortcut."
    }
    return [PSCustomObject]@{
      TargetPath = $shortcut.TargetPath
      Arguments = $shortcut.Arguments
      WorkingDirectory = $shortcut.WorkingDirectory
      AppUserModelId = [string]$propertyItem.ExtendedProperty("System.AppUserModel.ID")
    }
  } finally {
    if ($null -ne $propertyItem) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($propertyItem)
    }
    if ($null -ne $propertyFolder) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($propertyFolder)
    }
    if ($null -ne $propertyShell) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($propertyShell)
    }
    if ($null -ne $shortcut) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
    if ($null -ne $linkShell) {
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($linkShell)
    }
  }
}

function Start-InstalledShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$EntryPoint
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "The installed $EntryPoint shortcut disappeared before activation."
  }
  $environmentSnapshot = Get-InstalledLaunchEnvironmentSnapshot
  $previousPowerShellLocation = (Get-Location).Path
  $previousProcessDirectory = [Environment]::CurrentDirectory
  try {
    # A hosted runner's repository and toolcache can contain DLLs/tools that a
    # clean user's PATH does not. Activate the real, empty-working-directory
    # shell link from System32 with only the standard Windows system PATH. Do
    # not supply an explicit child working directory: that would mask the exact
    # behavior Explorer gives the NSIS-created shortcut.
    Set-InstalledLaunchEnvironmentClean -Snapshot $environmentSnapshot
    Set-Location -LiteralPath $cleanShellWorkingDirectory
    [Environment]::CurrentDirectory = $cleanShellWorkingDirectory
    $process = Start-Process `
      -FilePath $Path `
      -Verb Open `
      -PassThru
  } finally {
    try {
      Set-Location -LiteralPath $previousPowerShellLocation
    } finally {
      [Environment]::CurrentDirectory = $previousProcessDirectory
      Restore-InstalledLaunchEnvironment -Snapshot $environmentSnapshot
    }
  }
  if ($null -eq $process) {
    throw "Windows Shell did not return a process for the installed $EntryPoint shortcut."
  }
  return $process
}

function Get-InstalledLaunchEnvironmentSnapshot {
  $overrides = [ordered]@{}
  foreach ($entry in [Environment]::GetEnvironmentVariables("Process").GetEnumerator()) {
    $name = [string]$entry.Key
    if (
      $name.StartsWith("WEBVIEW2_", [StringComparison]::OrdinalIgnoreCase) -or
      [string]::Equals($name, "__COMPAT_LAYER", [StringComparison]::OrdinalIgnoreCase)
    ) {
      $overrides[$name] = [string]$entry.Value
    }
  }
  return [PSCustomObject]@{
    Path = [Environment]::GetEnvironmentVariable("Path", "Process")
    Overrides = $overrides
  }
}

function Set-InstalledLaunchEnvironmentClean {
  param([Parameter(Mandatory = $true)]$Snapshot)
  [Environment]::SetEnvironmentVariable("Path", $cleanLaunchPath, "Process")
  foreach ($name in $Snapshot.Overrides.Keys) {
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
}

function Restore-InstalledLaunchEnvironment {
  param([Parameter(Mandatory = $true)]$Snapshot)
  [Environment]::SetEnvironmentVariable("Path", $Snapshot.Path, "Process")
  foreach ($name in $Snapshot.Overrides.Keys) {
    [Environment]::SetEnvironmentVariable($name, $Snapshot.Overrides[$name], "Process")
  }
}

function Start-InstalledGui {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string[]]$Arguments = @()
  )
  if ((Split-Path -Parent $Path) -ne $expectedInstallDirectory) {
    throw "Refusing to launch a GUI outside the exact Relayune install directory."
  }
  $startParameters = @{
    FilePath = $Path
    WorkingDirectory = $expectedInstallDirectory
    PassThru = $true
  }
  if ($Arguments.Count -gt 0) {
    $startParameters.ArgumentList = $Arguments
  }
  $environmentSnapshot = Get-InstalledLaunchEnvironmentSnapshot
  try {
    Set-InstalledLaunchEnvironmentClean -Snapshot $environmentSnapshot
    return Start-Process @startParameters
  } finally {
    Restore-InstalledLaunchEnvironment -Snapshot $environmentSnapshot
  }
}

function Assert-NoBroadWriteAccess {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Description
  )
  $broadPrincipalSids = @(
    "S-1-1-0",       # Everyone
    "S-1-5-11",      # Authenticated Users
    "S-1-5-32-545",  # BUILTIN\Users
    "S-1-5-32-546"   # BUILTIN\Guests
  )
  $unsafeRights =
    [System.Security.AccessControl.FileSystemRights]::Write -bor
    [System.Security.AccessControl.FileSystemRights]::Delete -bor
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  $acl = Get-Acl -LiteralPath $Path
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
      continue
    }
    try {
      $sid = $rule.IdentityReference.Translate(
        [System.Security.Principal.SecurityIdentifier]
      ).Value
    } catch {
      throw "Could not resolve an ACL principal on installed $Description at $Path."
    }
    if (
      $sid -in $broadPrincipalSids -and
      (([int64]$rule.FileSystemRights -band [int64]$unsafeRights) -ne 0)
    ) {
      throw "Installed $Description grants unsafe write access to broad principal $sid."
    }
  }
}

function Get-InstalledLayout {
  param([Parameter(Mandatory = $true)][string]$Version)

  $entry = Wait-ForInstallEntry -Present $true
  if ($entry.DisplayVersion -ne $Version) {
    throw "Installed version $($entry.DisplayVersion) does not match $Version."
  }
  if ($entry.PSChildName -ne $ProductName) {
    throw "The installer registered an unexpected uninstall key $($entry.PSChildName)."
  }
  if ($entry.Publisher -ne $Publisher) {
    throw "The installer registered unexpected publisher $($entry.Publisher)."
  }
  $registeredUninstaller = Get-ExecutableFromCommand -Command $entry.UninstallString
  if (-not (Test-Path -LiteralPath $registeredUninstaller -PathType Leaf)) {
    throw "The registered uninstaller does not exist."
  }
  $expectedUninstallCommand = "`"$registeredUninstaller`""
  if ($entry.UninstallString -ne $expectedUninstallCommand) {
    throw "Windows Add/Remove Programs has an unexpected uninstall command."
  }
  $installDirectory = Split-Path -Parent $registeredUninstaller
  if ($installDirectory -ne $expectedInstallDirectory) {
    throw "The current-user installer used unexpected directory $installDirectory."
  }
  if ($entry.InstallLocation.Trim([char]34) -ne $expectedInstallDirectory) {
    throw "The registered install location does not match the current-user directory."
  }
  if (-not (Test-Path -LiteralPath $manufacturerProductKey)) {
    throw "The installer did not create the expected Publisher/Product metadata key."
  }
  if ((Get-Item -LiteralPath $manufacturerProductKey).GetValue("") -ne $expectedInstallDirectory) {
    throw "The Publisher/Product metadata does not remember the current-user install directory."
  }
  $appCandidates = @(
    Get-ChildItem -LiteralPath $installDirectory -Filter "*.exe" -File |
      Where-Object {
        $_.FullName -ne $registeredUninstaller -and
        $_.Name -ne "relayune-core.exe"
      }
  )
  if ($appCandidates.Count -ne 1) {
    throw "Expected one installed Relayune GUI executable, found $($appCandidates.Count)."
  }
  $appExecutable = $appCandidates[0].FullName
  $appVersionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($appExecutable)
  if ($appVersionInfo.ProductName -ne $ProductName) {
    throw "The installed GUI has unexpected ProductName $($appVersionInfo.ProductName)."
  }
  if ($appVersionInfo.ProductVersion -ne $Version) {
    throw "The installed GUI ProductVersion $($appVersionInfo.ProductVersion) does not match $Version."
  }
  $expectedDisplayIcon = "`"$appExecutable`""
  if ($entry.DisplayIcon -ne $expectedDisplayIcon) {
    throw "Windows Add/Remove Programs does not reference the installed Relayune icon."
  }
  if ($entry.MainBinaryName -ne [IO.Path]::GetFileName($appExecutable)) {
    throw "The uninstall metadata does not identify the installed Relayune GUI."
  }
  if ([int]$entry.NoModify -ne 1 -or [int]$entry.NoRepair -ne 1) {
    throw "Windows Add/Remove Programs exposes unsupported Modify or Repair actions."
  }
  if ($null -eq $entry.EstimatedSize -or [uint32]$entry.EstimatedSize -eq 0) {
    throw "Windows Add/Remove Programs has no non-zero installed size."
  }
  $appLocalDlls = @(Get-ChildItem -LiteralPath $installDirectory -Filter "*.dll" -File)
  if ($appLocalDlls.Count -ne 0) {
    throw "The current-user install contains unexpected app-local DLL payloads."
  }
  $sidecarPath = Join-Path $installDirectory "relayune-core.exe"
  if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
    throw "The installed Relayune sidecar is missing."
  }
  foreach ($payload in @(
    @{ Path = $installDirectory; Description = "directory" },
    @{ Path = $registeredUninstaller; Description = "uninstaller" },
    @{ Path = $appExecutable; Description = "GUI" },
    @{ Path = $sidecarPath; Description = "sidecar" }
  )) {
    Assert-NoBroadWriteAccess -Path $payload.Path -Description $payload.Description
  }
  foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
    if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) {
      throw "The silent NSIS install did not create expected shortcut $shortcut."
    }
    $shortcutLayout = Get-ShortcutLayout -Path $shortcut
    if ($shortcutLayout.TargetPath -ne $appExecutable) {
      throw "The NSIS shortcut does not target the installed Relayune GUI: $shortcut."
    }
    if (-not [string]::IsNullOrWhiteSpace($shortcutLayout.Arguments)) {
      throw "The NSIS shortcut unexpectedly adds launch arguments: $shortcut."
    }
    if (-not [string]::IsNullOrWhiteSpace($shortcutLayout.WorkingDirectory)) {
      throw "The NSIS shortcut unexpectedly supplies a working directory: $shortcut."
    }
    if ($shortcutLayout.AppUserModelId -ne $BundleIdentifier) {
      throw "The NSIS shortcut has an unexpected Windows AppUserModelID: $shortcut."
    }
  }
  return [PSCustomObject]@{
    Entry = $entry
    Uninstaller = $registeredUninstaller
    InstallDirectory = $installDirectory
    AppExecutable = $appExecutable
    Sidecar = $sidecarPath
  }
}

function Get-ExactRegistryValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  # RegistryKey.GetValue returns null only for a missing exact value. Access
  # errors still terminate under ErrorActionPreference=Stop, so cleanup cannot
  # mistake an unreadable pre-existing value for one created by this test.
  return (Get-Item -LiteralPath $Path).GetValue($Name, $null)
}

function Get-AutostartCommand {
  Get-ExactRegistryValue -Path $autostartRegistryPath -Name $ProductName
}

function Get-AutostartApproval {
  Get-ExactRegistryValue -Path $startupApprovedRegistryPath -Name $ProductName
}

function Test-AutostartApprovalEnabled {
  $actual = Get-AutostartApproval
  if ($null -eq $actual) { return $false }
  return [Convert]::ToBase64String([byte[]]$actual) -eq [Convert]::ToBase64String($enabledStartupApproval)
}

function Assert-ExpectedAutostartState {
  param([Parameter(Mandatory = $true)][string]$AppExecutable)
  $actualCommand = Get-AutostartCommand
  $actualApproval = Get-AutostartApproval
  if ($hasUpgradeBaseline) {
    $expectedCommand = "`"$AppExecutable`" --background"
    if ($actualCommand -ne $expectedCommand) {
      throw "The upgrade lifecycle did not retain the exact quoted login-start command."
    }
    if (-not (Test-AutostartApprovalEnabled)) {
      throw "The upgrade lifecycle did not retain the enabled StartupApproved value."
    }
  } else {
    if ($null -ne $actualCommand) {
      throw "The clean install or first launch unexpectedly enabled login startup."
    }
    if ($null -ne $actualApproval) {
      throw "The clean install or first launch unexpectedly created StartupApproved state."
    }
  }
}

function Get-WebView2RuntimeVersion {
  $runtimeId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  $registryPaths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$runtimeId",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$runtimeId",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$runtimeId"
  )
  foreach ($registryPath in $registryPaths) {
    # Reuse the exact-value probe so only a genuinely missing key/value is
    # treated as an absent runtime. Registry access failures must stop the
    # smoke instead of falsely claiming that the bootstrapper path ran.
    $version = Get-ExactRegistryValue -Path $registryPath -Name "pv"
    if (-not [string]::IsNullOrWhiteSpace($version) -and $version -ne "0.0.0.0") {
      return $version
    }
  }
  return $null
}

function Get-ExactPathProcesses {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)
  $processName = [IO.Path]::GetFileNameWithoutExtension($ExecutablePath)
  $candidates = @(Get-Process -Name $processName -ErrorAction SilentlyContinue)
  foreach ($candidate in $candidates) {
    $candidatePath = $null
    try {
      $candidatePath = $candidate.Path
    } catch {
      $pathError = $_.Exception.Message
      try {
        $candidate.Refresh()
        if ($candidate.HasExited) { continue }
      } catch [System.InvalidOperationException] {
        # The process exited between Get-Process and Path inspection.
        continue
      }
      throw "Could not inspect executable path for live $processName process $($candidate.Id): $pathError"
    }
    if ([string]::IsNullOrWhiteSpace($candidatePath)) {
      try {
        $candidate.Refresh()
        if ($candidate.HasExited) { continue }
      } catch [System.InvalidOperationException] {
        continue
      }
      throw "A live $processName process $($candidate.Id) returned no executable path."
    }
    if ($candidatePath -eq $ExecutablePath) { $candidate }
  }
}

function Test-ProcessTreeContainsName {
  param(
    [Parameter(Mandatory = $true)][int]$RootProcessId,
    [Parameter(Mandatory = $true)][string]$ProcessName
  )
  # Query one fail-closed process snapshot, then expand descendants from the
  # exact live GUI PID. A machine-wide msedgewebview2.exe from another app must
  # never satisfy Relayune's hidden-first-start WebView2 assertion.
  $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
  $treeIds = [System.Collections.Generic.HashSet[uint32]]::new()
  [void]$treeIds.Add([uint32]$RootProcessId)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($candidate in $processes) {
      if (
        $treeIds.Contains([uint32]$candidate.ParentProcessId) -and
        $treeIds.Add([uint32]$candidate.ProcessId)
      ) {
        $changed = $true
        if ([string]::Equals($candidate.Name, $ProcessName, [StringComparison]::OrdinalIgnoreCase)) {
          return $true
        }
      }
    }
  }
  return $false
}

function Get-OwnedProcessInstancesByName {
  param(
    [Parameter(Mandatory = $true)][int]$RootProcessId,
    [Parameter(Mandatory = $true)][string]$ProcessName
  )
  $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
  $treeIds = [System.Collections.Generic.HashSet[uint32]]::new()
  [void]$treeIds.Add([uint32]$RootProcessId)
  $matches = [System.Collections.Generic.List[object]]::new()
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($candidate in $processes) {
      if (
        $treeIds.Contains([uint32]$candidate.ParentProcessId) -and
        $treeIds.Add([uint32]$candidate.ProcessId)
      ) {
        $changed = $true
        if ([string]::Equals($candidate.Name, $ProcessName, [StringComparison]::OrdinalIgnoreCase)) {
          if ($null -eq $candidate.CreationDate) {
            throw "An owned $ProcessName process exposed no creation time."
          }
          [void]$matches.Add([PSCustomObject]@{
            ProcessId = [uint32]$candidate.ProcessId
            CreationTicks = ([DateTime]$candidate.CreationDate).ToUniversalTime().Ticks
          })
        }
      }
    }
  }
  return $matches
}

function Wait-ForOwnedProcessInstancesExit {
  param(
    [Parameter(Mandatory = $true)][object[]]$Snapshot,
    [Parameter(Mandatory = $true)][string]$ProcessName
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $remaining = @(
      foreach ($record in $Snapshot) {
        foreach ($candidate in $processes) {
          if (
            [uint32]$candidate.ProcessId -eq $record.ProcessId -and
            [string]::Equals($candidate.Name, $ProcessName, [StringComparison]::OrdinalIgnoreCase)
          ) {
            if ($null -eq $candidate.CreationDate) {
              throw "A live $ProcessName process exposed no creation time during cleanup."
            }
            if (([DateTime]$candidate.CreationDate).ToUniversalTime().Ticks -eq $record.CreationTicks) {
              $record
            }
          }
        }
      }
    )
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Owned $ProcessName process instances survived Relayune process-tree cleanup."
}

function Wait-ForWebView2Process {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$SidecarPath
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    Assert-BackgroundStartupSample -Process $Process -SidecarPath $SidecarPath
    if (Test-ProcessTreeContainsName -RootProcessId $Process.Id -ProcessName "msedgewebview2.exe") {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for the installed Relayune process $($Process.Id) to create its WebView2 process tree."
}

function Wait-ForVisibleWindowCount {
  param(
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [Parameter(Mandatory = $true)][int]$ExpectedCount
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $windows = @([RelayuneWindowProbe]::VisibleWindows([uint32]$TargetProcessId))
    if ($windows.Count -eq $ExpectedCount) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for Relayune process $TargetProcessId to have $ExpectedCount visible top-level window(s)."
}

function Wait-ForForegroundProcess {
  param([Parameter(Mandatory = $true)][int]$TargetProcessId)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    if ([RelayuneWindowProbe]::ForegroundProcessId() -eq [uint32]$TargetProcessId) {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for Relayune process $TargetProcessId to own the foreground window."
}

function Wait-ForAccessibleActionPattern {
  param(
    [Parameter(Mandatory = $true)][IntPtr]$WindowHandle,
    [Parameter(Mandatory = $true)][ValidateSet("Login", "Cancel")][string]$Action
  )
  $isChinese = $expectedUiLanguageCode -eq "zh-CN"
  $expectedName = if ($Action -eq "Login") {
    if ($isChinese) { "在浏览器中登录并连接" } else { "Sign in & connect in browser" }
  } else {
    if ($isChinese) { "取消连接" } else { "Cancel connection" }
  }
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
      if ($null -ne $root) {
        $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        foreach ($button in $buttons) {
          $name = [string]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $true
          )
          $enabled = [bool]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::IsEnabledProperty,
            $true
          )
          $offscreen = [bool]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::IsOffscreenProperty,
            $true
          )
          if (
            [string]::Equals($name, $expectedName, [StringComparison]::Ordinal) -and
            $enabled -and
            -not $offscreen
          ) {
            $invokePattern = $button.GetCurrentPattern(
              [System.Windows.Automation.InvokePattern]::Pattern
            )
            if ($null -ne $invokePattern) { return $invokePattern }
          }
        }
      }
    } catch {
      # WebView2 can rebuild its accessibility tree while the first document is
      # loading. Retry transient UIA failures, but time out fail-closed below.
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The Relayune window never exposed the enabled, visible, invokable $Action action for expected UI language $expectedUiLanguageCode."
}

function Wait-ForAccessibleLoginAction {
  param([Parameter(Mandatory = $true)][IntPtr]$WindowHandle)
  [void](Wait-ForAccessibleActionPattern -WindowHandle $WindowHandle -Action "Login")
}

function Wait-ForAccessibleLoginKeyboardFocus {
  param([Parameter(Mandatory = $true)][IntPtr]$WindowHandle)
  $expectedName = if ($expectedUiLanguageCode -eq "zh-CN") {
    "在浏览器中登录并连接"
  } else {
    "Sign in & connect in browser"
  }
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
      if ($null -ne $root) {
        $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        foreach ($button in $buttons) {
          $name = [string]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $true
          )
          $enabled = [bool]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::IsEnabledProperty,
            $true
          )
          $offscreen = [bool]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::IsOffscreenProperty,
            $true
          )
          $focused = [bool]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty,
            $true
          )
          if (
            [string]::Equals($name, $expectedName, [StringComparison]::Ordinal) -and
            $enabled -and
            -not $offscreen -and
            $focused
          ) {
            return
          }
        }
      }
    } catch {
      # requestAnimationFrame moves focus after rendering; retry transient UIA
      # tree rebuilds until the fixed login action actually owns keyboard focus.
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The first-login action did not receive keyboard focus for expected UI language $expectedUiLanguageCode."
}

function Wait-ForAccessibleStartupFailureRetryPattern {
  param([Parameter(Mandatory = $true)][IntPtr]$WindowHandle)
  $isChinese = $startupFallbackUiLanguageCode -eq "zh-CN"
  $expectedMessage = if ($isChinese) {
    "Relayune 暂时无法启动。请检查网络后重试，或打开帮助与诊断。"
  } else {
    "Relayune could not start. Check your connection, then try again or open Help & Diagnostics."
  }
  $expectedRetryName = if ($isChinese) { "重新尝试" } else { "Try again" }
  $buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $textCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
      if ($null -ne $root) {
        $failureVisible = $false
        foreach ($text in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)) {
          $name = [string]$text.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $true
          )
          $offscreen = [bool]$text.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::IsOffscreenProperty,
            $true
          )
          if (
            [string]::Equals($name, $expectedMessage, [StringComparison]::Ordinal) -and
            -not $offscreen
          ) {
            $failureVisible = $true
            break
          }
        }
        if ($failureVisible) {
          foreach ($button in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)) {
            $name = [string]$button.GetCurrentPropertyValue(
              [System.Windows.Automation.AutomationElement]::NameProperty,
              $true
            )
            $enabled = [bool]$button.GetCurrentPropertyValue(
              [System.Windows.Automation.AutomationElement]::IsEnabledProperty,
              $true
            )
            $offscreen = [bool]$button.GetCurrentPropertyValue(
              [System.Windows.Automation.AutomationElement]::IsOffscreenProperty,
              $true
            )
            $focused = [bool]$button.GetCurrentPropertyValue(
              [System.Windows.Automation.AutomationElement]::HasKeyboardFocusProperty,
              $true
            )
            if (
              [string]::Equals($name, $expectedRetryName, [StringComparison]::Ordinal) -and
              $enabled -and
              -not $offscreen -and
              $focused
            ) {
              $invokePattern = $button.GetCurrentPattern(
                [System.Windows.Automation.InvokePattern]::Pattern
              )
              if ($null -ne $invokePattern) { return $invokePattern }
            }
          }
        }
      }
    } catch {
      # Retry while WebView2 replaces its initial document with the fixed,
      # localized startup recovery surface.
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The malformed first-start config did not expose the focused startup Retry action in system UI language $startupFallbackUiLanguageCode."
}

function Wait-ForLoopbackPairingRequest {
  param(
    [Parameter(Mandatory = $true)]$Stub,
    [Parameter(Mandatory = $true)][int]$PreviousCount
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    if ($Stub.RequestCount -gt $PreviousCount) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Invoking the first-login action did not reach the isolated loopback pairing failure stub."
}

function Assert-LoopbackPairingRequestsStopped {
  param([Parameter(Mandatory = $true)]$Stub)
  $countAfterCancel = $Stub.RequestCount
  $deadline = [DateTime]::UtcNow.AddMilliseconds(2_500)
  do {
    Start-Sleep -Milliseconds 100
    if ($Stub.RequestCount -ne $countAfterCancel) {
      throw "The cancelled first-login flow continued sending pairing-start requests."
    }
  } while ([DateTime]::UtcNow -lt $deadline)
}

function Wait-ForAccessibleRecoveryCancelPattern {
  param([Parameter(Mandatory = $true)][IntPtr]$WindowHandle)
  $isChinese = $expectedUiLanguageCode -eq "zh-CN"
  $expectedRecoveryName = if ($isChinese) { "等待网络恢复…" } else { "Waiting for connection…" }
  $expectedCancelName = if ($isChinese) { "取消连接" } else { "Cancel connection" }
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
      if ($null -ne $root) {
        $recoveryVisible = $false
        $cancelPattern = $null
        $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        foreach ($button in $buttons) {
          $name = [string]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $true
          )
          $enabled = [bool]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::IsEnabledProperty,
            $true
          )
          $offscreen = [bool]$button.GetCurrentPropertyValue(
            [System.Windows.Automation.AutomationElement]::IsOffscreenProperty,
            $true
          )
          if (
            [string]::Equals($name, $expectedRecoveryName, [StringComparison]::Ordinal) -and
            -not $enabled -and
            -not $offscreen
          ) {
            $recoveryVisible = $true
          }
          if (
            [string]::Equals($name, $expectedCancelName, [StringComparison]::Ordinal) -and
            $enabled -and
            -not $offscreen
          ) {
            $cancelPattern = $button.GetCurrentPattern(
              [System.Windows.Automation.InvokePattern]::Pattern
            )
          }
        }
        if ($recoveryVisible -and $null -ne $cancelPattern) { return $cancelPattern }
      }
    } catch {
      # Retry while WebView2 renders the retryable failure state.
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "The isolated 503 did not expose recoverable, cancellable first-login UI for expected UI language $expectedUiLanguageCode."
}

function Assert-IsolatedConfigPreserved {
  $savedConfig = Get-Content -LiteralPath $testConfigPath -Raw | ConvertFrom-Json
  $expectedProperties = @($isolatedConfig.Keys)
  $actualProperties = @($savedConfig.PSObject.Properties.Name)
  if ($actualProperties.Count -ne $expectedProperties.Count) {
    throw "The failed or cancelled first-login flow changed the isolated config schema."
  }
  foreach ($property in $expectedProperties) {
    if ($property -notin $actualProperties) {
      throw "The failed or cancelled first-login flow removed isolated config field $property."
    }
  }

  foreach ($property in @(
    "server_url",
    "device_id",
    "adapter",
    "default_provider",
    "workspace",
    "codex_bin",
    "kimi_bin",
    "state_path"
  )) {
    if (-not [string]::Equals(
      [string]$savedConfig.$property,
      [string]$isolatedConfig[$property],
      [StringComparison]::Ordinal
    )) {
      throw "The failed or cancelled first-login flow changed isolated config field $property."
    }
  }
  if (([bool]$savedConfig.start_relay_on_launch) -ne ([bool]$isolatedConfig["start_relay_on_launch"])) {
    throw "The failed or cancelled first-login flow changed the isolated Relay launch preference."
  }
  if (@($savedConfig.browser_ids).Count -ne 0) {
    throw "The failed first-login flow persisted a browser authorization without completing pairing."
  }
  if ($null -eq $persistedUiLanguage) {
    if ($null -ne $savedConfig.ui_language) {
      throw "The system-language lifecycle unexpectedly persisted a UI language override."
    }
  } elseif (-not [string]::Equals([string]$savedConfig.ui_language, $persistedUiLanguage, [StringComparison]::Ordinal)) {
    throw "The persisted UI language changed during the Windows lifecycle."
  }
}

function Invoke-FirstLoginActionAndCancel {
  param(
    [Parameter(Mandatory = $true)][IntPtr]$WindowHandle,
    [Parameter(Mandatory = $true)]$Stub
  )
  $requestsBefore = $Stub.RequestCount
  $loginPattern = Wait-ForAccessibleActionPattern -WindowHandle $WindowHandle -Action "Login"
  $loginPattern.Invoke()

  # The local stub's fixed retryable 503 keeps the UI in its recoverable state.
  # We inspect only fixed action labels and an aggregate count, never the pairing
  # code, token, request body, or any dynamic status text.
  Wait-ForLoopbackPairingRequest -Stub $Stub -PreviousCount $requestsBefore
  $cancelPattern = Wait-ForAccessibleRecoveryCancelPattern -WindowHandle $WindowHandle
  $cancelPattern.Invoke()
  [void](Wait-ForAccessibleActionPattern -WindowHandle $WindowHandle -Action "Login")
  Assert-LoopbackPairingRequestsStopped -Stub $Stub
  Wait-ForAccessibleLoginKeyboardFocus -WindowHandle $WindowHandle
}

function Wait-ForPathAbsent {
  param([Parameter(Mandatory = $true)][string]$Path)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for path removal: $Path."
}

function Wait-ForPathPresent {
  param([Parameter(Mandatory = $true)][string]$Path)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for path creation: $Path."
}

function Assert-BackgroundStartupSample {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$SidecarPath
  )
  $Process.Refresh()
  if ($Process.HasExited) {
    throw "The installed background app exited during WebView2/tray initialization."
  }
  if (@([RelayuneWindowProbe]::VisibleWindows([uint32]$Process.Id)).Count -ne 0) {
    throw "A login-start Relayune process exposed a visible first-login window."
  }
  if ([RelayuneWindowProbe]::ForegroundProcessId() -eq [uint32]$Process.Id) {
    throw "A login-start Relayune process stole foreground focus while running in the background."
  }
  if (@(Get-ExactPathProcesses -ExecutablePath $SidecarPath).Count -ne 0) {
    throw "A clean unpaired background launch unexpectedly started the Relay sidecar."
  }
}

function Assert-BackgroundStartupIsQuiet {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [Parameter(Mandatory = $true)][string]$SidecarPath
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    Assert-BackgroundStartupSample -Process $Process -SidecarPath $SidecarPath
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
}

function Stop-ExactProcess {
  param($Process)
  if ($null -eq $Process) { return }
  $Process.Refresh()
  if ($Process.HasExited) { return }

  $processId = $Process.Id
  try {
    # Kill through the Process handle instead of looking the PID up again;
    # this avoids terminating an unrelated process if Windows reuses a PID.
    $Process.Kill($true)
  } catch {
    $Process.Refresh()
    if (-not $Process.HasExited) { throw }
  }
  if (-not $Process.WaitForExit(10_000)) {
    throw "Relayune process $processId survived exact process-tree cleanup."
  }
}

function Invoke-CleanupAction {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  try {
    & $Action
  } catch {
    $message = "$Description`: $($_.Exception.Message)"
    [void]$cleanupErrors.Add($message)
    Write-Warning $message
  }
}

try {
  if ($null -ne (Get-RelayuneInstallEntry)) {
    throw "$ProductName is already installed for this user; refusing to mutate an existing installation."
  }
  if (Test-Path -LiteralPath $expectedUninstallKey) {
    throw "The exact $ProductName uninstall key already exists; refusing to mutate it."
  }
  if (Test-Path -LiteralPath $expectedInstallDirectory) {
    throw "The exact $ProductName install directory already exists; refusing to mutate it."
  }
  if (Test-Path -LiteralPath $manufacturerProductKey) {
    throw "The exact $ProductName manufacturer metadata already exists; refusing to mutate it."
  }
  foreach ($dataDirectory in @($appDataDirectory, $webViewDataDirectory)) {
    if (Test-Path -LiteralPath $dataDirectory) {
      throw "An exact $ProductName app-data directory already exists; refusing to mutate user data."
    }
  }
  foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
    if (Test-Path -LiteralPath $shortcut) {
      throw "The exact $ProductName shortcut already exists; refusing to mutate it."
    }
  }
  if ($null -ne (Get-AutostartCommand)) {
    throw "The exact $ProductName autostart value already exists; refusing to mutate it."
  }
  if ($null -ne (Get-AutostartApproval)) {
    throw "The exact $ProductName StartupApproved value already exists; refusing to mutate it."
  }

  $installer = Get-SoleInstaller -Directory $InstallerDirectory
  foreach ($currentPayload in @($CurrentGuiSource, $CurrentSidecarSource)) {
    if (-not (Test-Path -LiteralPath $currentPayload -PathType Leaf)) {
      throw "A current packaged payload source does not exist: $currentPayload."
    }
  }
  if ($hasUpgradeBaseline) {
    $baselineInstaller = Get-SoleInstaller -Directory $BaselineInstallerDirectory
  }

  $webView2VersionBefore = Get-WebView2RuntimeVersion
  if ($null -eq $webView2VersionBefore) {
    Write-Host "WebView2 Runtime before install: missing (bootstrapper path will be exercised)."
  } else {
    Write-Host "WebView2 Runtime before install: $webView2VersionBefore (bootstrapper download will be skipped)."
  }
  $testMutationStarted = $true
  if ($hasUpgradeBaseline) {
    Invoke-SilentInstaller -Path $baselineInstaller.FullName
    $baselineLayout = Get-InstalledLayout -Version $ExpectedBaselineVersion
    $baselineGuiHash = (Get-FileHash -LiteralPath $baselineLayout.AppExecutable -Algorithm SHA256).Hash
    $baselineSidecarHash = (Get-FileHash -LiteralPath $baselineLayout.Sidecar -Algorithm SHA256).Hash

    New-Item -ItemType Directory -Path $appDataDirectory | Out-Null
    Set-Content -LiteralPath $upgradeSentinel -Value $ExpectedBaselineVersion -Encoding ascii -NoNewline
    $upgradeConfigFixture = [ordered]@{
      server_url = $expectedProductionServerUrl
      device_id = "dev_ci_upgrade_$([Guid]::NewGuid().ToString("N"))"
      adapter = "multi"
      default_provider = "kimi"
      workspace = $env:USERPROFILE
      codex_bin = ""
      kimi_bin = ""
      state_path = $testStatePath
      browser_ids = @()
      start_relay_on_launch = $true
      ui_language = $null
    } | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($testConfigPath, $upgradeConfigFixture, [Text.UTF8Encoding]::new($false))
    $preUpgradeConfigHash = (Get-FileHash -LiteralPath $testConfigPath -Algorithm SHA256).Hash
    $expectedAutostartCommand = "`"$($baselineLayout.AppExecutable)`" --background"
    Set-ItemProperty -LiteralPath $autostartRegistryPath -Name $ProductName -Value $expectedAutostartCommand
    if (-not (Test-Path -LiteralPath $startupApprovedRegistryPath)) {
      New-Item -Path $startupApprovedRegistryPath -Force | Out-Null
    }
    New-ItemProperty `
      -LiteralPath $startupApprovedRegistryPath `
      -Name $ProductName `
      -PropertyType Binary `
      -Value $enabledStartupApproval `
      -Force | Out-Null
    if (-not (Test-AutostartApprovalEnabled)) {
      throw "The synthetic baseline could not establish the enabled StartupApproved value."
    }

    # /UPDATE is the Tauri updater path. It must preserve user data, shortcuts,
    # and the enabled login-start value while replacing every executable.
    Invoke-SilentInstaller -Path $installer.FullName -Arguments @("/S", "/UPDATE")
    $layout = Get-InstalledLayout -Version $ExpectedVersion
    if ((Get-Content -LiteralPath $upgradeSentinel -Raw) -ne $ExpectedBaselineVersion) {
      throw "The updater path did not preserve the existing app-data sentinel."
    }
    if (-not (Test-Path -LiteralPath $testConfigPath -PathType Leaf)) {
      throw "The updater path deleted the existing Relayune config."
    }
    if ((Get-FileHash -LiteralPath $testConfigPath -Algorithm SHA256).Hash -ne $preUpgradeConfigHash) {
      throw "The updater path changed the existing Relayune config."
    }
    if ((Get-AutostartCommand) -ne "`"$($layout.AppExecutable)`" --background") {
      throw "The updater path did not preserve the quoted login-start command."
    }
    if (-not (Test-AutostartApprovalEnabled)) {
      throw "The updater path did not preserve the enabled StartupApproved value."
    }
    Remove-Item -LiteralPath $testConfigPath -Force
    if (Test-Path -LiteralPath $testConfigPath) {
      throw "Could not remove the non-secret upgrade config fixture before the real first run."
    }
  } else {
    Invoke-SilentInstaller -Path $installer.FullName
    $layout = Get-InstalledLayout -Version $ExpectedVersion
  }
  $uninstaller = $layout.Uninstaller
  $installDirectory = $layout.InstallDirectory
  $appExecutable = $layout.AppExecutable
  $sidecar = $layout.Sidecar
  $currentSourceGuiHash = (Get-FileHash -LiteralPath $CurrentGuiSource -Algorithm SHA256).Hash
  $installedGuiHash = (Get-FileHash -LiteralPath $appExecutable -Algorithm SHA256).Hash
  if ($installedGuiHash -ne $currentSourceGuiHash) {
    throw "NSIS installed a stale GUI instead of the current compiled executable."
  }
  if ($hasUpgradeBaseline -and $installedGuiHash -eq $baselineGuiHash) {
    throw "The synthetic baseline and current GUI hashes are identical; the GUI upgrade assertion is not executable."
  }
  $currentSourceSidecarHash = (Get-FileHash -LiteralPath $CurrentSidecarSource -Algorithm SHA256).Hash
  $installedSidecarHash = (Get-FileHash -LiteralPath $sidecar -Algorithm SHA256).Hash
  if ($installedSidecarHash -ne $currentSourceSidecarHash) {
    throw "NSIS installed a stale sidecar instead of the current packaged executable."
  }
  if ($hasUpgradeBaseline -and $installedSidecarHash -eq $baselineSidecarHash) {
    throw "The synthetic baseline and current sidecar hashes are identical; the upgrade assertion is not executable."
  }
  Assert-ExpectedAutostartState -AppExecutable $appExecutable
  $webView2VersionAfter = Get-WebView2RuntimeVersion
  if ($null -eq $webView2VersionAfter) {
    throw "WebView2 Runtime is still missing after NSIS installation."
  }
  Write-Host "WebView2 Runtime after install: $webView2VersionAfter."
  if (@(Get-ExactPathProcesses -ExecutablePath $appExecutable).Count -ne 0) {
    throw "The silent installer unexpectedly launched the Relayune GUI without /R."
  }
  if (Test-Path -LiteralPath $testConfigPath) {
    throw "The silent installer initialized Relayune config before the first explicit launch."
  }
  if (Test-Path -LiteralPath $webViewDataDirectory) {
    throw "The silent installer initialized WebView2 user data before the first explicit launch."
  }

  # First prove that the installed release creates its config through Tauri's
  # real current-user app_config_dir. This unpaired background start cannot
  # contact Relayune or start the sidecar; it only creates local default state.
  $defaultConfigProbe = Start-InstalledGui -Path $appExecutable -Arguments @("--background")
  Assert-BackgroundStartupIsQuiet -Process $defaultConfigProbe -SidecarPath $sidecar
  Wait-ForWebView2Process -Process $defaultConfigProbe -SidecarPath $sidecar
  Wait-ForPathPresent -Path $testConfigPath
  Assert-NoBroadWriteAccess -Path $testConfigDirectory -Description "config directory"
  Assert-NoBroadWriteAccess -Path $testConfigPath -Description "config file"
  $defaultFirstRunConfig = Get-Content -LiteralPath $testConfigPath -Raw | ConvertFrom-Json
  if (-not [string]::Equals(
    [string]$defaultFirstRunConfig.server_url,
    $expectedProductionServerUrl,
    [StringComparison]::Ordinal
  )) {
    throw "The real default config does not use the sole Relayune production server."
  }
  if ("ui_language" -notin @($defaultFirstRunConfig.PSObject.Properties.Name)) {
    throw "The real default config omitted its system-language preference field."
  }
  if ($null -ne $defaultFirstRunConfig.ui_language) {
    throw "The real default config unexpectedly overrides the Windows UI language."
  }
  if (@($defaultFirstRunConfig.browser_ids).Count -ne 0) {
    throw "The real default config unexpectedly started with a browser authorization."
  }
  $defaultStatePath = [string]$defaultFirstRunConfig.state_path
  if (
    -not [IO.Path]::IsPathFullyQualified($defaultStatePath) -or
    -not [string]::Equals(
      (Split-Path -Parent $defaultStatePath),
      $appDataDirectory,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) {
    throw "The real default config did not place Relay state in the current-user app-data directory."
  }
  $defaultWebView2Snapshot = @(
    Get-OwnedProcessInstancesByName -RootProcessId $defaultConfigProbe.Id -ProcessName "msedgewebview2.exe"
  )
  if ($defaultWebView2Snapshot.Count -eq 0) {
    throw "The real default-config background start did not own a WebView2 process."
  }
  Stop-ExactProcess -Process $defaultConfigProbe
  Wait-ForOwnedProcessInstancesExit -Snapshot $defaultWebView2Snapshot -ProcessName "msedgewebview2.exe"
  $defaultConfigProbe = $null

  # Now isolate first-login pairing from production while continuing to use
  # the same real config path. The loopback stub can never return pairing
  # success, so the default browser handoff remains unreachable.
  $pairingFailureStub = [RelayunePairingFailureStub]::new()
  $isolatedConfig = [ordered]@{
    server_url = "http://127.0.0.1:$($pairingFailureStub.Port)"
    device_id = "dev_ci_$([Guid]::NewGuid().ToString("N"))"
    adapter = "multi"
    default_provider = "kimi"
    workspace = $env:USERPROFILE
    codex_bin = ""
    kimi_bin = ""
    state_path = $testStatePath
    browser_ids = @()
    start_relay_on_launch = $true
    ui_language = $persistedUiLanguage
  }
  $isolatedConfigJson = $isolatedConfig | ConvertTo-Json -Depth 4
  # Force a deterministic, local bootstrap failure before the normal journey.
  # The malformed file contains no production data or secret and is replaced
  # externally before UIA invokes Retry, proving recovery through the installed
  # WebView rather than assuming that an exposed Retry button works.
  $malformedConfigText = "{"
  [IO.File]::WriteAllText($testConfigPath, $malformedConfigText, [Text.UTF8Encoding]::new($false))
  $malformedConfigHash = (Get-FileHash -LiteralPath $testConfigPath -Algorithm SHA256).Hash

  $primary = Start-InstalledGui -Path $appExecutable
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 1
  $startupFailureWindows = @([RelayuneWindowProbe]::VisibleWindows([uint32]$primary.Id))
  $startupFailureWindowHandle = $startupFailureWindows[0]
  if ([RelayuneWindowProbe]::WindowTitle($startupFailureWindowHandle) -ne $ProductName) {
    throw "The malformed-config first start did not expose the Relayune main window."
  }
  if (-not [RelayuneWindowProbe]::IsPerMonitorV2($startupFailureWindowHandle)) {
    throw "The startup recovery window is not Per-Monitor DPI Awareness v2."
  }
  $startupRetryPattern = Wait-ForAccessibleStartupFailureRetryPattern `
    -WindowHandle $startupFailureWindowHandle
  Wait-ForForegroundProcess -TargetProcessId $primary.Id
  if (-not (Test-Path -LiteralPath $testConfigPath -PathType Leaf)) {
    throw "The startup failure path deleted the malformed config before the user could repair it."
  }
  if ((Get-FileHash -LiteralPath $testConfigPath -Algorithm SHA256).Hash -ne $malformedConfigHash) {
    throw "The startup failure path changed the malformed config before the user could repair it."
  }
  [IO.File]::WriteAllText($testConfigPath, $isolatedConfigJson, [Text.UTF8Encoding]::new($false))
  $startupRetryPattern.Invoke()
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 1
  $startupRecoveredWindows = @([RelayuneWindowProbe]::VisibleWindows([uint32]$primary.Id))
  if ($startupRecoveredWindows[0] -ne $startupFailureWindowHandle) {
    throw "Startup Retry replaced the main window instead of recovering the existing window."
  }
  Wait-ForAccessibleLoginAction -WindowHandle $startupRecoveredWindows[0]
  Wait-ForAccessibleLoginKeyboardFocus -WindowHandle $startupRecoveredWindows[0]
  Assert-IsolatedConfigPreserved
  if (@(Get-ExactPathProcesses -ExecutablePath $sidecar).Count -ne 0) {
    throw "Recovering an unpaired first start unexpectedly started the sidecar."
  }

  # Do not let the later clean process hide a broken in-memory recovery state.
  # The process that actually survived startup failure and Retry must itself
  # close to tray, accept an installed-shortcut single-instance handoff, and
  # restore the same login HWND with keyboard focus.
  if (-not [RelayuneWindowProbe]::CloseWindow($startupFailureWindowHandle)) {
    throw "Could not close the startup-recovered Relayune window."
  }
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 0
  $primary.Refresh()
  if ($primary.HasExited) {
    throw "The startup-recovered Relayune process exited instead of remaining in the tray."
  }
  $startupRecoveryReopen = Start-InstalledShortcut `
    -Path $desktopShortcut `
    -EntryPoint "startup recovery desktop"
  if (-not $startupRecoveryReopen.WaitForExit(10_000)) {
    throw "The startup-recovery shortcut did not hand off to the recovered instance."
  }
  if ($startupRecoveryReopen.ExitCode -ne 0) {
    throw "The startup-recovery shortcut crashed instead of completing its handoff."
  }
  $primary.Refresh()
  if ($primary.HasExited) {
    throw "The recovered Relayune process exited after its single-instance handoff."
  }
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 1
  $startupRecoveryRestoredWindows = @(
    [RelayuneWindowProbe]::VisibleWindows([uint32]$primary.Id)
  )
  if ($startupRecoveryRestoredWindows[0] -ne $startupFailureWindowHandle) {
    throw "The startup-recovery handoff exposed a different window instead of restoring the recovered main window."
  }
  Wait-ForAccessibleLoginAction -WindowHandle $startupRecoveryRestoredWindows[0]
  Wait-ForAccessibleLoginKeyboardFocus -WindowHandle $startupRecoveryRestoredWindows[0]
  Wait-ForForegroundProcess -TargetProcessId $primary.Id
  Assert-IsolatedConfigPreserved
  if (@(Get-ExactPathProcesses -ExecutablePath $appExecutable).Count -ne 1) {
    throw "The startup-recovery handoff did not retain exactly one Relayune GUI process."
  }
  if (@(Get-ExactPathProcesses -ExecutablePath $sidecar).Count -ne 0) {
    throw "The startup-recovery handoff unexpectedly started the unpaired sidecar."
  }
  $ownedWebView2Snapshot = @(
    Get-OwnedProcessInstancesByName -RootProcessId $primary.Id -ProcessName "msedgewebview2.exe"
  )
  if ($ownedWebView2Snapshot.Count -eq 0) {
    throw "The startup recovery window did not own a WebView2 process before cleanup."
  }
  Stop-ExactProcess -Process $primary
  Wait-ForOwnedProcessInstancesExit -Snapshot $ownedWebView2Snapshot -ProcessName "msedgewebview2.exe"
  if (@(Get-ExactPathProcesses -ExecutablePath $appExecutable).Count -ne 0) {
    throw "The recovered first-start process remained alive after exact process-tree cleanup."
  }
  $primary = $null

  # After a recovered interactive first start, a new background process must
  # still initialize WebView2/tray without surfacing first-login UI.
  $primary = Start-InstalledGui -Path $appExecutable -Arguments @("--background")
  Assert-BackgroundStartupIsQuiet -Process $primary -SidecarPath $sidecar
  Wait-ForWebView2Process -Process $primary -SidecarPath $sidecar

  # Activate the actual NSIS desktop shortcut rather than bypassing the user's
  # installed entry point with a direct executable launch. It must hand off to
  # the existing process and terminate, then reveal the sole login window.
  $secondary = Start-InstalledShortcut -Path $desktopShortcut -EntryPoint "desktop"
  if (-not $secondary.WaitForExit(10_000)) {
    throw "The desktop shortcut launch did not hand off to the existing instance."
  }
  if ($secondary.ExitCode -ne 0) {
    throw "The desktop shortcut launch crashed instead of completing its handoff."
  }
  $primary.Refresh()
  if ($primary.HasExited) {
    throw "The primary Relayune process exited after the second-launch handoff."
  }
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 1
  $visibleWindows = @([RelayuneWindowProbe]::VisibleWindows([uint32]$primary.Id))
  $mainWindowHandle = $visibleWindows[0]
  if ([RelayuneWindowProbe]::WindowTitle($mainWindowHandle) -ne $ProductName) {
    throw "The sole visible process window is not the Relayune main window."
  }
  if (-not [RelayuneWindowProbe]::IsPerMonitorV2($mainWindowHandle)) {
    throw "The Relayune window is not Per-Monitor DPI Awareness v2 on the native runner."
  }
  Invoke-FirstLoginActionAndCancel -WindowHandle $mainWindowHandle -Stub $pairingFailureStub
  Assert-IsolatedConfigPreserved
  Wait-ForForegroundProcess -TargetProcessId $primary.Id

  # WM_CLOSE must run the same Tauri CloseRequested path as the title-bar close:
  # hide the window while leaving the tray process alive.
  if (-not [RelayuneWindowProbe]::CloseWindow($mainWindowHandle)) {
    throw "Could not post WM_CLOSE to the Relayune window."
  }
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 0
  $primary.Refresh()
  if ($primary.HasExited) {
    throw "Closing the Relayune window terminated the tray process."
  }

  # The installed Start menu shortcut must also reuse the same process and
  # reveal the hidden login window without starting an unpaired sidecar.
  $reopen = Start-InstalledShortcut -Path $startMenuShortcut -EntryPoint "Start menu"
  if (-not $reopen.WaitForExit(10_000)) {
    throw "The Start menu shortcut did not hand off after Relayune closed to tray."
  }
  if ($reopen.ExitCode -ne 0) {
    throw "The Start menu shortcut crashed instead of completing its reopen handoff."
  }
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 1
  $restoredWindows = @([RelayuneWindowProbe]::VisibleWindows([uint32]$primary.Id))
  if ($restoredWindows[0] -ne $mainWindowHandle) {
    throw "The reopen handoff exposed a different window instead of restoring the existing Relayune main window."
  }
  if ([RelayuneWindowProbe]::WindowTitle($restoredWindows[0]) -ne $ProductName) {
    throw "The restored visible process window is not the Relayune main window."
  }
  if (-not [RelayuneWindowProbe]::IsPerMonitorV2($restoredWindows[0])) {
    throw "The restored Relayune window lost Per-Monitor DPI Awareness v2."
  }
  Wait-ForAccessibleLoginAction -WindowHandle $restoredWindows[0]
  Wait-ForAccessibleLoginKeyboardFocus -WindowHandle $restoredWindows[0]
  Assert-IsolatedConfigPreserved
  Wait-ForForegroundProcess -TargetProcessId $primary.Id
  $samePathProcesses = @(Get-ExactPathProcesses -ExecutablePath $appExecutable)
  if ($samePathProcesses.Count -ne 1) {
    throw "Expected one installed Relayune GUI process, found $($samePathProcesses.Count)."
  }
  if (@(Get-ExactPathProcesses -ExecutablePath $sidecar).Count -ne 0) {
    throw "Restoring an unpaired Relayune window unexpectedly started the sidecar."
  }
  Assert-ExpectedAutostartState -AppExecutable $appExecutable

  $ownedWebView2Snapshot = @(
    Get-OwnedProcessInstancesByName -RootProcessId $primary.Id -ProcessName "msedgewebview2.exe"
  )
  if ($ownedWebView2Snapshot.Count -eq 0) {
    throw "The live Relayune GUI no longer owned a WebView2 process before cleanup."
  }
  Stop-ExactProcess -Process $primary
  Wait-ForOwnedProcessInstancesExit -Snapshot $ownedWebView2Snapshot -ProcessName "msedgewebview2.exe"
  if (@(Get-ExactPathProcesses -ExecutablePath $appExecutable).Count -ne 0) {
    throw "The Relayune GUI remained alive after exact process-tree cleanup."
  }
  $primary = $null

  # The same-process close/reopen journey cannot prove that cancellation left a
  # usable durable config. Start a new process before uninstall so a corrupted
  # config cannot remain hidden behind the first process's in-memory bootstrap.
  $primary = Start-InstalledGui -Path $appExecutable
  Wait-ForVisibleWindowCount -TargetProcessId $primary.Id -ExpectedCount 1
  $coldRestartWindows = @([RelayuneWindowProbe]::VisibleWindows([uint32]$primary.Id))
  if ([RelayuneWindowProbe]::WindowTitle($coldRestartWindows[0]) -ne $ProductName) {
    throw "The post-cancel cold restart did not expose the Relayune main window."
  }
  if (-not [RelayuneWindowProbe]::IsPerMonitorV2($coldRestartWindows[0])) {
    throw "The post-cancel cold restart lost Per-Monitor DPI Awareness v2."
  }
  Wait-ForAccessibleLoginAction -WindowHandle $coldRestartWindows[0]
  Wait-ForAccessibleLoginKeyboardFocus -WindowHandle $coldRestartWindows[0]
  Assert-IsolatedConfigPreserved
  Wait-ForForegroundProcess -TargetProcessId $primary.Id
  if (@(Get-ExactPathProcesses -ExecutablePath $appExecutable).Count -ne 1) {
    throw "The post-cancel cold restart did not create exactly one Relayune GUI process."
  }
  if (@(Get-ExactPathProcesses -ExecutablePath $sidecar).Count -ne 0) {
    throw "The unpaired post-cancel cold restart unexpectedly started the sidecar."
  }
  Assert-ExpectedAutostartState -AppExecutable $appExecutable

  # Keep the real post-cancel GUI and its WebView2 tree alive. The silent NSIS
  # uninstaller must exercise its current-user running-app path rather than
  # relying on CI to kill Relayune first. Use fixed non-secret retention
  # sentinels and assert them before finally performs exact runner cleanup.
  if (-not (Test-Path -LiteralPath $webViewDataDirectory -PathType Container)) {
    throw "The completed GUI lifecycle did not create its expected WebView2 user-data directory."
  }
  if (-not (Test-Path -LiteralPath $appDataDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $appDataDirectory | Out-Null
  }
  foreach ($sentinel in @($appDataRetentionSentinel, $webViewRetentionSentinel)) {
    Set-Content -LiteralPath $sentinel -Value $retentionMarker -Encoding ascii -NoNewline
  }

  $primary.Refresh()
  if ($primary.HasExited) {
    throw "The post-cancel tray process exited before silent uninstall could exercise it."
  }
  if (@(Get-ExactPathProcesses -ExecutablePath $appExecutable).Count -ne 1) {
    throw "The live-uninstall precondition lost the sole installed Relayune GUI process."
  }
  $ownedWebView2Snapshot = @(
    Get-OwnedProcessInstancesByName -RootProcessId $primary.Id -ProcessName "msedgewebview2.exe"
  )
  if ($ownedWebView2Snapshot.Count -eq 0) {
    throw "The post-cancel cold restart did not own a WebView2 process before live uninstall."
  }
  $preUninstallConfigHash = (Get-FileHash -LiteralPath $testConfigPath -Algorithm SHA256).Hash
  Invoke-SilentInstaller -Path $uninstaller
  if (-not $primary.WaitForExit(10_000)) {
    throw "Silent uninstall did not stop the live Relayune tray process."
  }
  Wait-ForOwnedProcessInstancesExit -Snapshot $ownedWebView2Snapshot -ProcessName "msedgewebview2.exe"
  if (@(Get-ExactPathProcesses -ExecutablePath $appExecutable).Count -ne 0) {
    throw "A Relayune GUI process survived silent uninstall."
  }
  $primary = $null
  Wait-ForInstallEntry -Present $false | Out-Null
  # DisplayName can disappear before (or without) the enclosing key. Assert the
  # exact key is gone here so finally cleanup cannot hide a partial uninstall.
  Wait-ForPathAbsent -Path $expectedUninstallKey
  Wait-ForPathAbsent -Path $expectedInstallDirectory
  foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
    if (Test-Path -LiteralPath $shortcut) {
      throw "The Relayune shortcut remains after uninstall: $shortcut."
    }
  }
  if ($null -ne (Get-AutostartCommand)) {
    throw "The Relayune login-start value remains after uninstall."
  }
  if ($null -ne (Get-AutostartApproval)) {
    throw "The Relayune StartupApproved value remains after uninstall."
  }
  if (-not (Test-Path -LiteralPath $manufacturerProductKey)) {
    throw "Silent uninstall unexpectedly deleted the retained Publisher/Product metadata."
  }
  if ($hasUpgradeBaseline -and -not (Test-Path -LiteralPath $upgradeSentinel -PathType Leaf)) {
    throw "Silent uninstall unexpectedly deleted the preserved user-data sentinel."
  }
  if (-not (Test-Path -LiteralPath $testConfigPath -PathType Leaf)) {
    throw "Silent uninstall unexpectedly deleted the durable Relayune config."
  }
  if ((Get-FileHash -LiteralPath $testConfigPath -Algorithm SHA256).Hash -ne $preUninstallConfigHash) {
    throw "Silent uninstall unexpectedly changed the durable Relayune config."
  }
  foreach ($sentinel in @($appDataRetentionSentinel, $webViewRetentionSentinel)) {
    if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
      throw "Silent uninstall unexpectedly deleted a durable user-data sentinel."
    }
    if ((Get-Content -LiteralPath $sentinel -Raw) -ne $retentionMarker) {
      throw "Silent uninstall unexpectedly changed a durable user-data sentinel."
    }
  }
  $lifecycleCompleted = $true

} catch {
  $lifecycleError = $_
} finally {
  Invoke-CleanupAction -Description "Could not stop the default-config background probe" -Action {
    Stop-ExactProcess -Process $defaultConfigProbe
  }
  Invoke-CleanupAction -Description "Could not stop the startup-recovery reopen process" -Action {
    Stop-ExactProcess -Process $startupRecoveryReopen
  }
  Invoke-CleanupAction -Description "Could not stop the reopen process" -Action { Stop-ExactProcess -Process $reopen }
  Invoke-CleanupAction -Description "Could not stop the secondary process" -Action { Stop-ExactProcess -Process $secondary }
  Invoke-CleanupAction -Description "Could not stop the primary process" -Action { Stop-ExactProcess -Process $primary }
  if ($null -ne $pairingFailureStub) {
    Invoke-CleanupAction -Description "Could not stop the isolated pairing failure stub" -Action {
      $pairingFailureStub.Dispose()
    }
  }
  Invoke-CleanupAction -Description "Could not remove the real first-run config directory" -Action {
    if (Test-Path -LiteralPath $testConfigDirectory) {
      Remove-Item -LiteralPath $testConfigDirectory -Recurse -Force
    }
  }
  if ($testMutationStarted -and ($null -eq $uninstaller -or -not (Test-Path -LiteralPath $uninstaller))) {
    Invoke-CleanupAction -Description "Could not resolve the CI cleanup uninstaller" -Action {
      $cleanupEntry = Get-RelayuneInstallEntry
      if ($null -ne $cleanupEntry) {
        $script:uninstaller = Get-ExecutableFromCommand -Command $cleanupEntry.UninstallString
      }
    }
  }
  if ($testMutationStarted -and $null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller)) {
    Invoke-CleanupAction -Description "Could not run the CI cleanup uninstaller" -Action {
      Invoke-SilentInstaller -Path $uninstaller
    }
  }
  if ($testMutationStarted -and (Test-Path -LiteralPath $expectedInstallDirectory)) {
    Invoke-CleanupAction -Description "Could not remove the exact CI install directory" -Action {
      Remove-Item -LiteralPath $expectedInstallDirectory -Recurse -Force
    }
  }
  if ($testMutationStarted -and (Test-Path -LiteralPath $expectedUninstallKey)) {
    Invoke-CleanupAction -Description "Could not remove the exact CI uninstall key" -Action {
      Remove-Item -LiteralPath $expectedUninstallKey -Recurse -Force
    }
  }
  if ($testMutationStarted -and (Test-Path -LiteralPath $manufacturerProductKey)) {
    Invoke-CleanupAction -Description "Could not remove exact CI manufacturer metadata" -Action {
      Remove-Item -LiteralPath $manufacturerProductKey -Recurse -Force
    }
  }
  foreach ($dataDirectory in @($appDataDirectory, $webViewDataDirectory)) {
    if ($testMutationStarted -and (Test-Path -LiteralPath $dataDirectory)) {
      Invoke-CleanupAction -Description "Could not remove exact CI app data $dataDirectory" -Action {
        Remove-Item -LiteralPath $dataDirectory -Recurse -Force
      }
    }
  }
  foreach ($shortcut in @($desktopShortcut, $startMenuShortcut)) {
    if ($testMutationStarted -and (Test-Path -LiteralPath $shortcut)) {
      Invoke-CleanupAction -Description "Could not remove exact CI shortcut $shortcut" -Action {
        Remove-Item -LiteralPath $shortcut -Force
      }
    }
  }
  if ($testMutationStarted -and $null -ne (Get-AutostartCommand)) {
    Invoke-CleanupAction -Description "Could not remove the exact CI autostart value" -Action {
      Remove-ItemProperty -LiteralPath $autostartRegistryPath -Name $ProductName
    }
  }
  if ($testMutationStarted -and $null -ne (Get-AutostartApproval)) {
    Invoke-CleanupAction -Description "Could not remove the exact CI StartupApproved value" -Action {
      Remove-ItemProperty -LiteralPath $startupApprovedRegistryPath -Name $ProductName
    }
  }
  if ($testMutationStarted -and -not $startupApprovedKeyExisted -and (Test-Path -LiteralPath $startupApprovedRegistryPath)) {
    Invoke-CleanupAction -Description "Could not remove the empty CI-created StartupApproved key" -Action {
      $startupApprovedKey = Get-Item -LiteralPath $startupApprovedRegistryPath
      if ($startupApprovedKey.ValueCount -eq 0 -and $startupApprovedKey.SubKeyCount -eq 0) {
        Remove-Item -LiteralPath $startupApprovedRegistryPath -Force
      }
    }
  }
}

if ($null -ne $lifecycleError) {
  throw $lifecycleError
}
if ($cleanupErrors.Count -ne 0) {
  throw "Windows lifecycle passed but exact cleanup failed: $($cleanupErrors -join '; ')"
}
if (-not $lifecycleCompleted) {
  throw "Windows lifecycle did not reach its completion assertion."
}

Write-Host "Verified native Windows install lifecycle for $ProductName $ExpectedVersion."
Write-Host "Covered: silent install, updater-preserved data/autostart approval, live desktop/Start-menu shortcut activation, sidecar replacement, owned WebView2 process tree, loopback-isolated first-login invoke/cancel recovery, durable-config cold restart, hidden startup, same-HWND foreground restore, close-to-tray, single instance, Per-Monitor DPI Awareness v2, and silent uninstall of the live tray/WebView2 process tree with app/WebView user-data retention."
