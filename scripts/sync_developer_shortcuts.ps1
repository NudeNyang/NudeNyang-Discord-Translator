param([switch]$Restart)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$developerDirectory = Join-Path $projectRoot 'dist\NudeNyangDiscordTranslator'
$developerExe = Join-Path $developerDirectory 'NudeNyangDiscordTranslator.exe'
$builtExe = Join-Path $projectRoot 'src-tauri\target\x86_64-pc-windows-msvc\release\nude-translator-tauri.exe'
$legacyExe = Join-Path $projectRoot 'src-tauri\target\release\nude-translator-tauri.exe'
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json).version
foreach ($path in @($developerExe, $builtExe)) {
    if ((Get-Item -LiteralPath $path).VersionInfo.ProductVersion -ne $version) {
        throw "Executable version does not match $version`: $path"
    }
}
if ((Get-FileHash -LiteralPath $developerExe).Hash -ne (Get-FileHash -LiteralPath $builtExe).Hash) {
    throw 'The developer executable does not match the x64 build.'
}

$name = 'NudeNyang Discord Translator (Tauri).lnk'
$projectShortcut = Join-Path $projectRoot $name
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
$paths = @($projectShortcut)
if (Test-Path -LiteralPath $desktopShortcut) { $paths += $desktopShortcut }
$shell = New-Object -ComObject WScript.Shell
# Validate all existing targets before changing either shortcut. Other installations
# and other project checkouts must keep their own shortcuts.
foreach ($path in $paths) {
    if ((Test-Path -LiteralPath $path) -and $shell.CreateShortcut($path).TargetPath -notin @($developerExe, $builtExe, $legacyExe)) {
        throw "Shortcut points to another installation: $path"
    }
}
foreach ($path in $paths) {
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $developerExe
    $shortcut.WorkingDirectory = $developerDirectory
    $shortcut.IconLocation = "$developerExe,0"
    $shortcut.Save()
    $saved = $shell.CreateShortcut($path)
    if ($saved.TargetPath -ne $developerExe -or $saved.WorkingDirectory -ne $developerDirectory -or $saved.IconLocation -ne "$developerExe,0") {
        throw "Shortcut verification failed: $path"
    }
}

if ($Restart) {
    $knownPaths = @($developerExe, $builtExe, $legacyExe)
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'NudeNyangDiscordTranslator.exe' OR Name = 'nude-translator-tauri.exe'" |
        Where-Object { $_.ExecutablePath -in $knownPaths -and $_.CommandLine -notmatch '--discord-cdp-pipe-guardian' })
    if ($running | Where-Object { $_.ExecutablePath -ne $developerExe -and $_.CommandLine -match 'chrome-extension://|whale-extension://|--parent-window|--browser-native-host' }) {
        # Update an already-used browser bridge before closing it, otherwise the
        # browser immediately starts another copy of the old executable.
        $registration = Start-Process -FilePath $developerExe -ArgumentList '--register-browser-native-host' -WindowStyle Hidden -Wait -PassThru
        if ($registration.ExitCode -ne 0) { throw 'Could not update the existing browser bridge registration.' }
    }
    foreach ($app in $running) {
        $current = Get-Process -Id $app.ProcessId -ErrorAction SilentlyContinue
        if ($current -and $current.Path -in $knownPaths) { $current | Stop-Process -Force }
    }
    Start-Process -FilePath $projectShortcut -WindowStyle Hidden
    Start-Sleep -Seconds 4
    $main = @(Get-CimInstance Win32_Process -Filter "Name = 'NudeNyangDiscordTranslator.exe'" |
        Where-Object { $_.ExecutablePath -eq $developerExe -and $_.CommandLine -notmatch 'chrome-extension://|whale-extension://|--parent-window|--browser-native-host|--discord-cdp-pipe-guardian' })
    if ($main.Count -ne 1) { throw 'Expected exactly one developer app process.' }
    $process = Get-Process -Id $main[0].ProcessId
    if ($process.MainModule.FileVersionInfo.ProductVersion -ne $version -or !$process.Responding) {
        throw 'The developer app failed its running version/responding check.'
    }
    [pscustomobject]@{ ProcessId = $process.Id; Version = $version; Executable = $process.Path; Responding = $process.Responding }
}
foreach ($path in $paths) {
    [pscustomobject]@{ Shortcut = $path; Target = $developerExe; WorkingDirectory = $developerDirectory; Icon = "$developerExe,0" }
}
