<#
.SYNOPSIS
Safely installs the Image Slideshow plugin and starts profile import.

.DESCRIPTION
Requires Windows PowerShell 5.1. Run from the delivered outputs directory. The script
validates sibling artifacts against SHA256SUMS.txt, refuses to run while Ulanzi Studio
is active, installs through a validated staging directory, preserves a timestamped
backup when replacing a different plugin, and rolls back automatically on failure.

The script never modifies ProfilesV1, installed profiles, or exported profile files.
If Windows has no verified .ulanziDeckProfile association to UlanziDeck.exe, Studio is
opened normally and the exact profile path is printed for manual import.

.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-ImageSlidePlugin.ps1 -WhatIf

.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-ImageSlidePlugin.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$PluginName = 'com.arkamax.ulanzi.imageslide.ulanziPlugin'
$PluginZip = Join-Path $PSScriptRoot ($PluginName + '.zip')
$ProfileFile = Join-Path $PSScriptRoot 'ImageSlide.ulanziDeckProfile'
$SumsFile = Join-Path $PSScriptRoot 'SHA256SUMS.txt'
$StudioExe = 'C:\Program Files (x86)\UlanziDeck\UlanziDeck.exe'
$ExpectedPluginUuid = 'com.arkamax.ulanzi.imageslide'
$ExpectedActionUuid = 'com.arkamax.ulanzi.imageslide.slideshow'
$ExpectedSetupUuid = 'com.arkamax.ulanzi.imageslide.setup'
$ExpectedCodePath = 'plugin/app.js'
$ExpectedPluginVersion = '0.7.1'

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Assert-PathUnderRoot {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Root, [switch]$AllowRoot)
    $candidate = Get-NormalizedPath $Path
    $rootPath = Get-NormalizedPath $Root
    $inside = $candidate.StartsWith(($rootPath + '\'), [System.StringComparison]::OrdinalIgnoreCase)
    if ($AllowRoot -and $candidate.Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) { $inside = $true }
    if (-not $inside) { throw "Resolved path is outside the allowed root: $candidate" }
    return $candidate
}

function Get-ExpectedHash {
    param([Parameter(Mandatory = $true)][string]$FileName)
    if (-not (Test-Path -LiteralPath $SumsFile -PathType Leaf)) { throw "Missing checksum file: $SumsFile" }
    $found = @()
    foreach ($line in [System.IO.File]::ReadAllLines($SumsFile)) {
        if ($line -match '^([0-9a-fA-F]{64})  (.+)$' -and $Matches[2] -ceq $FileName) { $found += $Matches[1].ToLowerInvariant() }
    }
    if ($found.Count -ne 1) { throw "SHA256SUMS.txt must contain exactly one entry for $FileName" }
    return $found[0]
}

function Get-Sha256Direct {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = $null
    $algorithm = $null
    try {
        $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        if ($null -ne $algorithm) { $algorithm.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Assert-ArtifactHash {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing artifact: $Path" }
    $expected = Get-ExpectedHash ([System.IO.Path]::GetFileName($Path))
    $actual = Get-Sha256Direct $Path
    if ($actual -ne $expected) { throw "SHA-256 mismatch for $([System.IO.Path]::GetFileName($Path))" }
    return $actual
}

function Get-FileInventory {
    param([Parameter(Mandatory = $true)][string]$Root)
    $rootPath = Get-NormalizedPath $Root
    $inventory = [ordered]@{}
    foreach ($file in Get-ChildItem -LiteralPath $rootPath -Recurse -File | Sort-Object FullName) {
        $full = Assert-PathUnderRoot -Path $file.FullName -Root $rootPath
        $relative = $full.Substring($rootPath.Length + 1).Replace('\', '/')
        $inventory[$relative] = Get-Sha256Direct $full
    }
    return $inventory
}

function Compare-Inventories {
    param($Left, $Right)
    return ((ConvertTo-Json $Left -Compress) -ceq (ConvertTo-Json $Right -Compress))
}

function Assert-ZipEntriesSafe {
    param([Parameter(Mandatory = $true)][string]$ZipPath, [Parameter(Mandatory = $true)][string]$StagingRoot)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $roots = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or $name -match '^[A-Za-z]:' -or $name.Split('/') -contains '..') { throw "Unsafe ZIP entry: $name" }
            [void]$roots.Add($name.Split('/')[0])
            [void](Assert-PathUnderRoot -Path (Join-Path $StagingRoot $name.Replace('/', '\')) -Root $StagingRoot)
        }
        if ($roots.Count -ne 1 -or -not $roots.Contains($PluginName)) { throw "Plugin ZIP must contain exactly one root named $PluginName" }
    }
    finally { $archive.Dispose() }
}

function Assert-PluginContent {
    param([Parameter(Mandatory = $true)][string]$Root)
    $rootPath = Assert-PathUnderRoot -Path $Root -Root (Split-Path -Parent $Root)
    foreach ($relative in @('manifest.json', 'config.json', 'plugin/app.js', 'plugin/slideshow.js', 'plugin/setup.js', 'plugin/protocol-client.js', 'property-inspector/inspector.html', 'property-inspector/inspector.js', 'property-inspector/setup.html', 'property-inspector/setup-inspector.js', 'helper/Start-ImageSlideSetup.ps1', 'helper/Invoke-ImageSlideSetup.ps1', 'helper/Apply-ImageSlideSetup.cmd', 'helper/compatibility.json', 'node_modules/sharp/dist/index.mjs', 'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.4.node', 'node_modules/ws/index.js')) {
        $essential = Assert-PathUnderRoot -Path (Join-Path $rootPath $relative.Replace('/', '\')) -Root $rootPath
        if (-not (Test-Path -LiteralPath $essential -PathType Leaf)) { throw "Missing essential plugin file: $relative" }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $rootPath 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.UUID -cne $ExpectedPluginUuid) { throw 'Unexpected plugin manifest UUID' }
    if ($manifest.CodePath -cne $ExpectedCodePath) { throw 'Unexpected plugin manifest CodePath' }
    if ($manifest.Version -cne $ExpectedPluginVersion) { throw 'Unexpected plugin manifest version' }
    $actions = @($manifest.Actions | Where-Object { $_.UUID -ceq $ExpectedActionUuid })
    if ($actions.Count -ne 1) { throw 'Expected slideshow action is missing or duplicated' }
    if ($actions[0].PropertyInspectorPath -cne 'property-inspector/inspector.html') { throw 'Unexpected Property Inspector path' }
    $setupActions = @($manifest.Actions | Where-Object { $_.UUID -ceq $ExpectedSetupUuid })
    if ($setupActions.Count -ne 1 -or $setupActions[0].PropertyInspectorPath -cne 'property-inspector/setup.html') { throw 'Expected setup action is missing, duplicated, or malformed' }
}

function Get-VerifiedProfileAssociation {
    param([Parameter(Mandatory = $true)][string]$ExpectedExecutable)
    $progIds = New-Object System.Collections.Generic.List[string]
    $userChoice = Get-ItemProperty -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.ulanziDeckProfile\UserChoice' -ErrorAction SilentlyContinue
    if ($userChoice -and $userChoice.ProgId) { $progIds.Add([string]$userChoice.ProgId) }
    foreach ($extensionKey in @('Registry::HKEY_CURRENT_USER\Software\Classes\.ulanziDeckProfile', 'Registry::HKEY_CLASSES_ROOT\.ulanziDeckProfile')) {
        $item = Get-Item -LiteralPath $extensionKey -ErrorAction SilentlyContinue
        if ($item) { $value = $item.GetValue(''); if ($value) { $progIds.Add([string]$value) } }
    }
    $expected = Get-NormalizedPath $ExpectedExecutable
    foreach ($progId in $progIds | Select-Object -Unique) {
        foreach ($commandKey in @("Registry::HKEY_CURRENT_USER\Software\Classes\$progId\shell\open\command", "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command")) {
            $item = Get-Item -LiteralPath $commandKey -ErrorAction SilentlyContinue
            if (-not $item) { continue }
            $command = [string]$item.GetValue('')
            if ($command -notmatch '(?i)%1' -and $command -notmatch '(?i)%L') { continue }
            if ($command -match [regex]::Escape($expected)) { return [pscustomobject]@{ ProgId = $progId; Command = $command } }
        }
    }
    return $null
}

$pluginRoot = $null
$stagingRoot = $null
$destination = $null
$backupPath = $null
$deployed = $false

try {
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -ieq 'UlanziDeck' -or $_.ProcessName -ieq 'Ulanzi Studio' })
    if ($running.Count -gt 0) { throw 'Ulanzi Studio is running. Close it manually and run the installer again; no process was stopped.' }
    if (-not (Test-Path -LiteralPath $StudioExe -PathType Leaf)) { throw "Ulanzi Studio 3.2.11 executable was not found at $StudioExe" }

    $pluginHash = Assert-ArtifactHash $PluginZip
    $profileHash = Assert-ArtifactHash $ProfileFile
    $appDataRoot = Get-NormalizedPath $env:APPDATA
    $ulanziRoot = Assert-PathUnderRoot -Path (Join-Path $appDataRoot 'Ulanzi\UlanziDeck') -Root $appDataRoot
    $pluginRoot = Assert-PathUnderRoot -Path (Join-Path $ulanziRoot 'Plugins') -Root $ulanziRoot
    $destination = Assert-PathUnderRoot -Path (Join-Path $pluginRoot $PluginName) -Root $pluginRoot
    $backupRoot = Assert-PathUnderRoot -Path (Join-Path $pluginRoot '_arkamax_imageslide_backups') -Root $pluginRoot
    $token = [guid]::NewGuid().ToString('N')
    $stagingRoot = Assert-PathUnderRoot -Path (Join-Path $pluginRoot ('.arkamax-imageslide-staging-' + $token)) -Root $pluginRoot

    Assert-ZipEntriesSafe -ZipPath $PluginZip -StagingRoot $stagingRoot
    Write-Host "Validated plugin SHA-256: $pluginHash"
    Write-Host "Validated profile SHA-256: $profileHash"

    if ($WhatIfPreference) {
        Write-Host 'PASS: preflight validation succeeded. -WhatIf made no filesystem changes and launched nothing.'
        Write-Host "Planned plugin destination: $destination"
        Write-Host "Planned profile import: $ProfileFile"
        exit 0
    }

    if (-not $PSCmdlet.ShouldProcess($pluginRoot, 'Create or validate the Ulanzi plugin root')) { throw 'Installation was not approved.' }
    [System.IO.Directory]::CreateDirectory($pluginRoot) | Out-Null
    if (-not $PSCmdlet.ShouldProcess($stagingRoot, 'Extract and validate plugin staging content')) { throw 'Installation was not approved.' }
    [System.IO.Directory]::CreateDirectory($stagingRoot) | Out-Null
    Expand-Archive -LiteralPath $PluginZip -DestinationPath $stagingRoot
    $stagedPlugin = Assert-PathUnderRoot -Path (Join-Path $stagingRoot $PluginName) -Root $stagingRoot
    Assert-PluginContent $stagedPlugin
    $sourceInventory = Get-FileInventory $stagedPlugin

    if (Test-Path -LiteralPath $destination) {
        $destinationInventory = Get-FileInventory $destination
        if (Compare-Inventories $sourceInventory $destinationInventory) { Write-Host 'Existing plugin is already byte-for-byte identical; replacement skipped.' }
        else {
            [System.IO.Directory]::CreateDirectory($backupRoot) | Out-Null
            $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
            $backupPath = Assert-PathUnderRoot -Path (Join-Path $backupRoot ($PluginName + '-' + $stamp + '-' + $token.Substring(0, 8))) -Root $backupRoot
            if (-not $PSCmdlet.ShouldProcess($destination, "Move existing plugin to backup $backupPath")) { throw 'Backup was not approved.' }
            Move-Item -LiteralPath $destination -Destination $backupPath
            if (-not $PSCmdlet.ShouldProcess($stagedPlugin, "Rename staged plugin into $destination")) { throw 'Deployment was not approved.' }
            Move-Item -LiteralPath $stagedPlugin -Destination $destination
            $deployed = $true
        }
    }
    else {
        if (-not $PSCmdlet.ShouldProcess($stagedPlugin, "Rename staged plugin into $destination")) { throw 'Deployment was not approved.' }
        Move-Item -LiteralPath $stagedPlugin -Destination $destination
        $deployed = $true
    }

    Assert-PluginContent $destination
    $installedInventory = Get-FileInventory $destination
    if (-not (Compare-Inventories $sourceInventory $installedInventory)) { throw 'Installed plugin inventory does not match staged source' }

    if (Test-Path -LiteralPath $stagingRoot) { [void](Assert-PathUnderRoot -Path $stagingRoot -Root $pluginRoot); Remove-Item -LiteralPath $stagingRoot -Recurse -Force }

    $association = Get-VerifiedProfileAssociation -ExpectedExecutable $StudioExe
    if ($PSCmdlet.ShouldProcess($StudioExe, 'Start Ulanzi Studio normally')) { Start-Process -FilePath $StudioExe -WindowStyle Normal }
    if ($association) {
        if ($PSCmdlet.ShouldProcess($ProfileFile, "Start profile import using verified association $($association.ProgId)")) { Start-Sleep -Seconds 2; Start-Process -FilePath $ProfileFile -WindowStyle Normal }
        Write-Host 'PASS: plugin installed and the patched-profile import handoff was started through the verified Windows association.'
        Write-Host 'Remaining step: confirm the import as "Image Slideshow" and run the physical PASS/FAIL test in README.md.'
    }
    else {
        Write-Host 'PARTIAL: plugin installed and Ulanzi Studio started, but no verified .ulanziDeckProfile association was found.'
        Write-Host "Import this NEW independent clone manually: $ProfileFile"
        Write-Host 'Select "Image Slideshow". Remove or ignore any older patched copy, but do not overwrite or delete the original "Arkamax" profile.'
    }
    exit 0
}
catch {
    $failure = $_.Exception.Message
    try {
        if ($deployed -and $destination -and (Test-Path -LiteralPath $destination)) {
            $safePluginRoot = Get-NormalizedPath $pluginRoot
            [void](Assert-PathUnderRoot -Path $destination -Root $safePluginRoot)
            $rollbackRoot = Assert-PathUnderRoot -Path (Join-Path $safePluginRoot '_arkamax_imageslide_backups') -Root $safePluginRoot
            [System.IO.Directory]::CreateDirectory($rollbackRoot) | Out-Null
            $failedPath = Assert-PathUnderRoot -Path (Join-Path $rollbackRoot ($PluginName + '-failed-' + [guid]::NewGuid().ToString('N'))) -Root $rollbackRoot
            Move-Item -LiteralPath $destination -Destination $failedPath
        }
        if ($backupPath -and (Test-Path -LiteralPath $backupPath) -and -not (Test-Path -LiteralPath $destination)) {
            [void](Assert-PathUnderRoot -Path $backupPath -Root (Split-Path -Parent $backupPath))
            Move-Item -LiteralPath $backupPath -Destination $destination
            Write-Host 'Rollback restored the previous plugin.'
        }
        if ($stagingRoot -and $pluginRoot -and (Test-Path -LiteralPath $stagingRoot)) { [void](Assert-PathUnderRoot -Path $stagingRoot -Root $pluginRoot); Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
    }
    catch { Write-Warning "Rollback needs manual attention: $($_.Exception.Message)" }
    Write-Error "FAIL: $failure"
    exit 1
}
