# start-bridge.ps1 - open Chrome with CDP 9222 + persistent profile .chrome-profile (claude.ai logged in once)
# Usage:  powershell -ExecutionPolicy Bypass -File start-bridge.ps1   (or  .\start-bridge.ps1)
# NOTE: keep this file ASCII-only so it runs under any PowerShell/ANSI code page.
$ErrorActionPreference = "Stop"
$port = 9222
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $dir ".chrome-profile"

# already running?
try {
    $null = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2
    Write-Output "Chrome debug already running on port $port. (nothing to do)"
    return
} catch {
    # not running -> launch
}

if (-not (Test-Path $chrome)) {
    Write-Output "Chrome not found at '$chrome'. Edit `$chrome at the top of this file."
    exit 1
}

Start-Process -FilePath $chrome -ArgumentList @(
    "--remote-debugging-port=$port",
    "--user-data-dir=`"$profileDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "https://claude.ai/new"
)
Write-Output "Started Chrome (profile .chrome-profile) on port $port."
Write-Output "First run: sign in to claude.ai in this window once; keep it open afterwards."

# wait for CDP (max 30s)
for ($i = 0; $i -lt 15; $i++) {
    try {
        $null = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2
        Write-Output "CDP 9222 is ready."
        return
    } catch {
        Start-Sleep -Seconds 2
    }
}
Write-Output "CDP not up after 30s - check that Chrome is running."
