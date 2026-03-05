# RobinPath installer for Windows
# Usage: irm https://dev.robinpath.com/install.ps1 | iex
& {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    $Repo = "nabivogedu/robinpath-cli"
    $InstallDir = "$env:USERPROFILE\.robinpath\bin"
    $BinaryName = "robinpath-windows-x64.exe"

    Write-Host ""
    Write-Host "  RobinPath" -ForegroundColor Cyan -NoNewline
    Write-Host " Installer" -ForegroundColor White
    Write-Host ""

    # Get latest release
    Write-Host "  > " -ForegroundColor DarkCyan -NoNewline
    Write-Host "Fetching latest release" -ForegroundColor Gray
    try {
        $Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    } catch {
        Write-Host "  error: " -ForegroundColor Red -NoNewline
        Write-Host "Could not reach GitHub. Check your connection."
        Write-Host ""
        return
    }

    $Version = $Release.tag_name
    $LatestClean = $Version -replace '^v', ''

    # Skip if already on latest version
    $CurrentVersion = $env:ROBINPATH_CURRENT_VERSION
    if ($CurrentVersion -and $CurrentVersion -eq $LatestClean) {
        Write-Host "  success: " -ForegroundColor Green -NoNewline
        Write-Host "Already on the latest version (v$CurrentVersion)."
        Write-Host ""
        return
    }

    if ($CurrentVersion) {
        Write-Host "  > " -ForegroundColor DarkCyan -NoNewline
        Write-Host "Upgrading v$CurrentVersion -> $Version"
    }

    $Asset = $Release.assets | Where-Object { $_.name -eq $BinaryName } | Select-Object -First 1

    if (-not $Asset) {
        Write-Host "  error: " -ForegroundColor Red -NoNewline
        Write-Host "No binary found for Windows x64 in $Version."
        Write-Host "         Visit https://github.com/$Repo/releases" -ForegroundColor DarkGray
        Write-Host ""
        return
    }

    $SizeMB = [math]::Round($Asset.size / 1MB, 1)
    Write-Host "  > " -ForegroundColor DarkCyan -NoNewline
    Write-Host "Downloading $Version " -NoNewline
    Write-Host "($SizeMB MB)" -ForegroundColor DarkGray

    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $ExePath = "$InstallDir\robinpath.exe"
    $RpPath = "$InstallDir\rp.exe"
    $TempPath = "$InstallDir\robinpath-new.exe"

    # Download
    $DownloadUrl = $Asset.browser_download_url
    try {
        $WebClient = New-Object System.Net.WebClient
        $WebClient.DownloadFile($DownloadUrl, $TempPath)
    } catch {
        Write-Host "  error: " -ForegroundColor Red -NoNewline
        Write-Host "Download failed. $_"
        Write-Host ""
        return
    }

    # Replace the existing binary
    Write-Host "  > " -ForegroundColor DarkCyan -NoNewline
    Write-Host "Installing to $InstallDir" -ForegroundColor Gray
    try {
        if (Test-Path $ExePath) {
            $OldPath = "$InstallDir\robinpath-old.exe"
            if (Test-Path $OldPath) { Remove-Item $OldPath -Force }
            Rename-Item $ExePath $OldPath -Force
        }
        Rename-Item $TempPath $ExePath -Force
        Copy-Item $ExePath $RpPath -Force

        $OldPath = "$InstallDir\robinpath-old.exe"
        if (Test-Path $OldPath) {
            try { Remove-Item $OldPath -Force } catch { }
        }
    } catch {
        Write-Host "  error: " -ForegroundColor Red -NoNewline
        Write-Host "Could not replace binary. $_"
        Write-Host ""
        return
    }

    # Verify
    try {
        $InstalledVersion = & $ExePath --version 2>&1
    } catch {
        Write-Host "  error: " -ForegroundColor Red -NoNewline
        Write-Host "Binary downloaded but failed to execute."
        Write-Host ""
        return
    }

    # Add to PATH if not already there
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $AddedPath = $false

    if ($UserPath -notlike "*$InstallDir*") {
        $NewPath = "$InstallDir;$UserPath"
        [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
        $env:Path = "$InstallDir;$env:Path"
        $AddedPath = $true
    }

    Write-Host ""
    Write-Host "  success: " -ForegroundColor Green -NoNewline
    Write-Host "$InstalledVersion installed."
    Write-Host ""

    if ($AddedPath) {
        Write-Host "  Restart your terminal, then run:" -ForegroundColor DarkGray
    } else {
        Write-Host "  To get started, run:" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "    robinpath --help" -ForegroundColor White
    Write-Host ""
}
