param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    $projectDir = $PSScriptRoot
    $installationHash = [System.Security.Cryptography.SHA256]::Create()
    try {
        $installationBytes = [System.Text.Encoding]::UTF8.GetBytes(([System.IO.Path]::GetFullPath($projectDir).TrimEnd('\')).ToLowerInvariant())
        $installationId = ([System.BitConverter]::ToString($installationHash.ComputeHash($installationBytes))).Replace('-', '').ToLowerInvariant().Substring(0, 16)
    } finally { $installationHash.Dispose() }
    $runtimeDir = Join-Path $projectDir '.work'
    [void](New-Item -ItemType Directory -Path $runtimeDir -Force)
    $nodeCandidates = @()
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
    $nodeCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    $nodeExecutable = $null
    foreach ($candidate in $nodeCandidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $versionText = & $candidate --version
            if ($versionText -match '^v(\d+)\.(\d+)\.') {
                if ([int]$Matches[1] -gt 20 -or ([int]$Matches[1] -eq 20 -and [int]$Matches[2] -ge 3)) {
                    $nodeExecutable = $candidate
                    break
                }
            }
        }
    }
    if (-not $nodeExecutable) { throw 'Please install Node.js 20.3 or later, then open Youju again: https://nodejs.org' }

    $chosenPort = $null
    $reused = $false
    foreach ($candidatePort in 4318..4328) {
        $existingHealth = $null
        try { $existingHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$candidatePort/api/health" -TimeoutSec 1 } catch { }
        if ($existingHealth.app -eq 'youju-detective' -and $existingHealth.installationId -eq $installationId) {
            $chosenPort = $candidatePort
            $reused = $true
            break
        }
        $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidatePort)
        try { $probe.Start(); $chosenPort = $candidatePort } catch { } finally { $probe.Stop() }
        if ($chosenPort) { break }
    }
    if (-not $chosenPort) { throw 'Ports 4318-4328 are busy. Close an unused local service, then try again.' }
    $appUrl = "http://127.0.0.1:$chosenPort/"
    if (-not $reused) {
        $serverFile = Join-Path $projectDir 'server.mjs'
        $serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @(('"{0}"' -f $serverFile), '--port', $chosenPort) -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'server.log') -RedirectStandardError (Join-Path $runtimeDir 'server-error.log')
        $ready = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 250
            try {
                $existingHealth = Invoke-RestMethod -Uri ($appUrl + 'api/health') -TimeoutSec 1
                if ($existingHealth.app -eq 'youju-detective' -and $existingHealth.installationId -eq $installationId) { $ready = $true; break }
            } catch { }
            if ($serverProcess.HasExited) { break }
        }
        if (-not $ready) { throw 'Youju did not start. See .work\server-error.log, or run node server.mjs in this folder.' }
    }
    @{ url = $appUrl; pid = $existingHealth.pid; startedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'service.json') -Encoding UTF8
    if (-not $NoBrowser) { Start-Process $appUrl }
    Write-Output $appUrl
} catch {
    $failureMessage = $_.Exception.Message
    if (-not $NoBrowser) {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($failureMessage, 'Youju - Startup help')
    }
    Write-Error $failureMessage
    exit 1
}
