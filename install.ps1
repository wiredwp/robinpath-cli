# RobinPath installer for Windows
# Usage: irm https://dev.robinpath.com/install.ps1 | iex
& {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    $Repo = "nabivogedu/robinpath-cli"
    $InstallDir = "$env:USERPROFILE\.robinpath\bin"
    $BinaryName = "robinpath-windows-x64.exe"

    Write-Host ""
    Write-Host "  ╭─────────────────────────────╮" -ForegroundColor DarkCyan
    Write-Host "  │                             │" -ForegroundColor DarkCyan
    Write-Host "  │   " -ForegroundColor DarkCyan -NoNewline
    Write-Host "RobinPath Installer" -ForegroundColor Cyan -NoNewline
    Write-Host "   │" -ForegroundColor DarkCyan
    Write-Host "  │                             │" -ForegroundColor DarkCyan
    Write-Host "  ╰─────────────────────────────╯" -ForegroundColor DarkCyan
    Write-Host ""

    # Get latest release
    Write-Host "  [1/4] " -ForegroundColor DarkGray -NoNewline
    Write-Host "Fetching latest release..." -ForegroundColor White
    try {
        $Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    } catch {
        Write-Host ""
        Write-Host "  ✗ No releases found." -ForegroundColor Red
        Write-Host "    Visit https://github.com/$Repo/releases" -ForegroundColor DarkGray
        Write-Host ""
        return
    }

    $Version = $Release.tag_name
    $LatestClean = $Version -replace '^v', ''

    # Skip if already on latest version
    $CurrentVersion = $env:ROBINPATH_CURRENT_VERSION
    if ($CurrentVersion -and $CurrentVersion -eq $LatestClean) {
        Write-Host ""
        Write-Host "  ✓ Already up to date (v$CurrentVersion)" -ForegroundColor Green
        Write-Host ""
        return
    }

    $Asset = $Release.assets | Where-Object { $_.name -eq $BinaryName } | Select-Object -First 1

    if (-not $Asset) {
        Write-Host ""
        Write-Host "  ✗ Binary not found in $Version" -ForegroundColor Red
        Write-Host "    Visit https://github.com/$Repo/releases" -ForegroundColor DarkGray
        Write-Host ""
        return
    }

    $SizeMB = [math]::Round($Asset.size / 1MB, 1)
    Write-Host "  [2/4] " -ForegroundColor DarkGray -NoNewline
    Write-Host "Downloading $Version " -ForegroundColor White -NoNewline
    Write-Host "($SizeMB MB)" -ForegroundColor DarkGray

    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $ExePath = "$InstallDir\robinpath.exe"
    $RpPath = "$InstallDir\rp.exe"
    $TempPath = "$InstallDir\robinpath-new.exe"

    # Download with progress
    $DownloadUrl = $Asset.browser_download_url
    try {
        $WebClient = New-Object System.Net.WebClient
        $WebClient.DownloadFile($DownloadUrl, $TempPath)
    } catch {
        Write-Host ""
        Write-Host "  ✗ Download failed: $_" -ForegroundColor Red
        Write-Host ""
        return
    }

    # Replace the existing binary
    Write-Host "  [3/4] " -ForegroundColor DarkGray -NoNewline
    Write-Host "Installing..." -ForegroundColor White
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
        Write-Host ""
        Write-Host "  ✗ Could not replace binary: $_" -ForegroundColor Red
        Write-Host ""
        return
    }

    # Verify
    Write-Host "  [4/4] " -ForegroundColor DarkGray -NoNewline
    Write-Host "Verifying..." -ForegroundColor White
    try {
        $InstalledVersion = & $ExePath --version 2>&1
    } catch {
        Write-Host ""
        Write-Host "  ✗ Binary downloaded but failed to execute." -ForegroundColor Red
        Write-Host ""
        return
    }

    Write-Host ""
    Write-Host "  ✓ Installed $InstalledVersion" -ForegroundColor Green

    # Add to PATH if not already there
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")

    if ($UserPath -notlike "*$InstallDir*") {
        $NewPath = "$InstallDir;$UserPath"
        [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
        $env:Path = "$InstallDir;$env:Path"

        Write-Host "  ✓ Added to PATH" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Restart your terminal, then run:" -ForegroundColor DarkGray
        Write-Host "    robinpath --version" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "  Run:" -ForegroundColor DarkGray
        Write-Host "    robinpath --version" -ForegroundColor Cyan
    }
    Write-Host ""
}
