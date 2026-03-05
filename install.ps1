# RobinPath installer for Windows
# Usage: irm https://dev.robinpath.com/install.ps1 | iex
& {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    $Repo = "wiredwp/robinpath-cli"
    $InstallDir = "$env:USERPROFILE\.robinpath\bin"
    $BinaryName = "robinpath-windows-x64.exe"
    $StartTime = Get-Date

    # Right-aligned verb helper (Cargo-style)
    function Step($Verb, $Message, $Color) {
        $pad = " " * (12 - $Verb.Length)
        Write-Host "$pad$Verb" -ForegroundColor $Color -NoNewline
        Write-Host " $Message"
    }

    Write-Host ""

    # Fetching
    Step "Fetching" "latest release..." "Cyan"
    try {
        $Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    } catch {
        Step "error" "Could not reach GitHub. Check your connection." "Red"
        Write-Host ""
        return
    }

    $Version = $Release.tag_name
    $LatestClean = $Version -replace '^v', ''

    # Skip if already on latest version
    $CurrentVersion = $env:ROBINPATH_CURRENT_VERSION
    if ($CurrentVersion -and $CurrentVersion -eq $LatestClean) {
        Step "Up to date" "robinpath v$CurrentVersion" "Green"
        Write-Host ""
        return
    }

    if ($CurrentVersion) {
        Step "Upgrading" "v$CurrentVersion -> $Version" "Cyan"
    }

    $Asset = $Release.assets | Where-Object { $_.name -eq $BinaryName } | Select-Object -First 1

    if (-not $Asset) {
        Step "error" "No binary for Windows x64 in $Version." "Red"
        Write-Host "               Visit https://github.com/$Repo/releases" -ForegroundColor DarkGray
        Write-Host ""
        return
    }

    # Create install directory
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $ExePath = "$InstallDir\robinpath.exe"
    $RpPath = "$InstallDir\rp.exe"
    $TempPath = "$InstallDir\robinpath-new.exe"

    # Download with progress bar (streamed)
    $DownloadUrl = $Asset.browser_download_url
    $TotalBytes = $Asset.size
    $TotalMB = [math]::Round($TotalBytes / 1MB, 1)
    $BarWidth = 20
    try {
        $HttpClient = New-Object System.Net.Http.HttpClient
        $Response = $HttpClient.GetAsync($DownloadUrl, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
        $Response.EnsureSuccessStatusCode() | Out-Null
        $Stream = $Response.Content.ReadAsStreamAsync().Result
        $FileStream = [System.IO.File]::Create($TempPath)
        $Buffer = New-Object byte[] 65536
        $Downloaded = 0
        $LastDraw = 0

        while (($Read = $Stream.Read($Buffer, 0, $Buffer.Length)) -gt 0) {
            $FileStream.Write($Buffer, 0, $Read)
            $Downloaded += $Read

            # Update bar every 500KB
            if (($Downloaded - $LastDraw) -ge 524288) {
                $LastDraw = $Downloaded
                $Pct = [math]::Min($Downloaded / $TotalBytes, 1)
                $Filled = [math]::Floor($Pct * $BarWidth)
                $Empty = $BarWidth - $Filled
                $Bar = ("=" * $Filled) + ("-" * $Empty)
                $CurrentMB = [math]::Round($Downloaded / 1MB, 1)
                Write-Host "`r Downloading [$Bar] ${CurrentMB}/${TotalMB} MB  " -NoNewline
            }
        }

        $FileStream.Close()
        $Stream.Close()
        $HttpClient.Dispose()

        Write-Host "`r Downloading [$("=" * $BarWidth)] ${TotalMB}/${TotalMB} MB  "
    } catch {
        Write-Host ""
        Step "error" "Download failed. $_" "Red"
        Write-Host ""
        return
    }

    # Install
    Step "Installing" "$InstallDir" "Cyan"
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
        Step "error" "Could not replace binary. $_" "Red"
        Write-Host ""
        return
    }

    # Verify
    try {
        $InstalledVersion = & $ExePath --version 2>&1
    } catch {
        Step "error" "Binary downloaded but failed to execute." "Red"
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

    $Elapsed = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 1)
    Step "Installed" "$InstalledVersion in ${Elapsed}s" "Green"
    Write-Host ""

    if ($AddedPath) {
        Write-Host "  Restart your terminal, then run:" -ForegroundColor DarkGray
    } else {
        Write-Host "  To get started, run:" -ForegroundColor DarkGray
    }
    Write-Host "    robinpath --help" -ForegroundColor White
    Write-Host ""
}
