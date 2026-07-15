# P2P Command Hub - PowerShell Agent (Windows)
# Lightweight HTTP-polling agent for Windows environments.
# Compatible with PowerShell 5.1+ (Windows PowerShell) and PowerShell 7+

# ======================================================
# Configuration
# ======================================================
$SERVER_URL = "http://localhost:3000"
$SECRET_TOKEN = "p2p_secure_agent_token_2026"
$POLL_INTERVAL = 1  # seconds

# ======================================================
# Persistent Agent ID
# ======================================================
$ID_FILE = "$env:USERPROFILE\.p2p_ps_agent_id"
if (Test-Path $ID_FILE) {
    $AGENT_ID = (Get-Content $ID_FILE -Raw).Trim()
} else {
    $AGENT_ID = "ps_" + [System.Guid]::NewGuid().ToString()
    Set-Content -Path $ID_FILE -Value $AGENT_ID -NoNewline
}

# ======================================================
# System Metadata
# ======================================================
$HOSTNAME = $env:COMPUTERNAME
$OS_INFO = [System.Environment]::OSVersion.VersionString
$PLATFORM = "Windows $([System.Environment]::OSVersion.Version.Major).$([System.Environment]::OSVersion.Version.Minor)"

function Get-LocalIP {
    try {
        $udp = New-Object System.Net.Sockets.UdpClient
        $udp.Connect("8.8.8.8", 80)
        $ip = $udp.Client.LocalEndPoint.Address.ToString()
        $udp.Close()
        return $ip
    } catch {
        try {
            $ip = (Get-NetIPAddress -AddressFamily IPv4 |
                   Where-Object { $_.IPAddress -ne "127.0.0.1" } |
                   Select-Object -First 1).IPAddress
            return $ip
        } catch {
            return "127.0.0.1"
        }
    }
}

function Get-SystemMetrics {
    $cpu = 0.0
    $ram = 0.0
    try {
        $cpu = (Get-WmiObject -Class Win32_Processor -ErrorAction SilentlyContinue |
                Measure-Object -Property LoadPercentage -Average).Average
        if ($null -eq $cpu) { $cpu = 0.0 }
    } catch {}
    try {
        $os = Get-WmiObject -Class Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os) {
            $ram = [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100, 1)
        }
    } catch {}
    return @{ cpu = $cpu; ram = $ram }
}

function Get-DockerStatus {
    try {
        $null = & docker --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $null = & docker ps 2>&1
            if ($LASTEXITCODE -eq 0) { return "connected" }
            return "installed"
        }
    } catch {}
    return "none"
}

# ======================================================
# HTTP Helpers (works on PS 5.1 and PS 7+)
# ======================================================
function Invoke-AgentGet {
    param([string]$Url)
    try {
        # Disable progress bar for speed
        $ProgressPreference = 'SilentlyContinue'
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        return $response.Content
    } catch {
        return $null
    }
}

function Invoke-AgentPost {
    param([string]$Url, [hashtable]$Body)
    try {
        $ProgressPreference = 'SilentlyContinue'
        $formBody = ($Body.GetEnumerator() | ForEach-Object {
            [System.Uri]::EscapeDataString($_.Key) + "=" + [System.Uri]::EscapeDataString([string]$_.Value)
        }) -join "&"
        $response = Invoke-WebRequest -Uri $Url -Method POST -Body $formBody `
            -ContentType "application/x-www-form-urlencoded" `
            -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        return $response.Content
    } catch {
        return $null
    }
}

function Parse-JsonValue {
    param([string]$Json, [string]$Key)
    # Simple regex-based parser (avoids ConvertFrom-Json issues on PS 5.1 with nulls)
    if ($Json -match """$Key""\s*:\s*""([^""]*)""") {
        return $Matches[1]
    }
    if ($Json -match """$Key""\s*:\s*(true|false|null)") {
        return $Matches[1]
    }
    if ($Json -match """$Key""\s*:\s*([0-9.]+)") {
        return $Matches[1]
    }
    return $null
}

# ======================================================
# Command Execution
# ======================================================
$ActiveJobs = @{}  # commandId -> Job

function Start-CommandExecution {
    param([string]$CommandId, [string]$Cmd)

    Write-Host "Executing: $Cmd (ID: $CommandId)"

    $job = Start-Job -ScriptBlock {
        param($cmd)
        try {
            # Run command via cmd.exe to support CMD built-ins and PowerShell
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "cmd.exe"
            $psi.Arguments = "/c " + $cmd
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true

            $proc = [System.Diagnostics.Process]::Start($psi)

            # Read all output (combined stdout + stderr)
            $stdout = $proc.StandardOutput.ReadToEnd()
            $stderr = $proc.StandardError.ReadToEnd()
            $proc.WaitForExit()
            $exitCode = $proc.ExitCode

            return @{
                output   = $stdout + $stderr
                exitCode = $exitCode
            }
        } catch {
            return @{
                output   = "Execution Error: $_`n"
                exitCode = -1
            }
        }
    } -ArgumentList $Cmd

    $ActiveJobs[$CommandId] = $job
    return $job
}

function Process-FinishedJobs {
    param([string]$AgentId)
    $finished = @()
    foreach ($entry in $ActiveJobs.GetEnumerator()) {
        $cmdId = $entry.Key
        $job = $entry.Value
        if ($job.State -eq "Completed" -or $job.State -eq "Failed") {
            $finished += $cmdId
            try {
                $result = Receive-Job -Job $job -Wait
                Remove-Job -Job $job -Force

                $output = ""
                $exitCode = -1
                if ($result -and $result.output -ne $null) {
                    $output = $result.output
                    $exitCode = $result.exitCode
                }

                # Send output in chunks (max 60KB per chunk)
                if ($output.Length -gt 0) {
                    $chunkSize = 60000
                    for ($i = 0; $i -lt $output.Length; $i += $chunkSize) {
                        $chunk = $output.Substring($i, [math]::Min($chunkSize, $output.Length - $i))
                        $null = Invoke-AgentPost -Url "$SERVER_URL/api/agent/response" -Body @{
                            id        = $AgentId
                            token     = $SECRET_TOKEN
                            commandId = $cmdId
                            output    = $chunk
                            isEof     = "false"
                        }
                    }
                }

                # Send EOF
                $null = Invoke-AgentPost -Url "$SERVER_URL/api/agent/response" -Body @{
                    id        = $AgentId
                    token     = $SECRET_TOKEN
                    commandId = $cmdId
                    output    = ""
                    isEof     = "true"
                    exitCode  = "$exitCode"
                }
                Write-Host "Finished command ($cmdId) with exit code $exitCode"
            } catch {
                Write-Host "Error processing job result for $cmdId : $_"
            }
        }
    }
    foreach ($id in $finished) { $ActiveJobs.Remove($id) }
}

function Stop-Command {
    param([string]$CommandId)
    if ($ActiveJobs.ContainsKey($CommandId)) {
        Write-Host "Killing command $CommandId"
        Stop-Job -Job $ActiveJobs[$CommandId] -ErrorAction SilentlyContinue
        Remove-Job -Job $ActiveJobs[$CommandId] -Force -ErrorAction SilentlyContinue
        $ActiveJobs.Remove($CommandId)
    }
}

# ======================================================
# Main Loop
# ======================================================
$IP = Get-LocalIP
$DockerStatus = Get-DockerStatus

Write-Host "=============================================="
Write-Host " Starting P2P PowerShell Agent (Windows)     "
Write-Host " Agent ID:   $AGENT_ID"
Write-Host " Hostname:   $HOSTNAME"
Write-Host " Platform:   $PLATFORM"
Write-Host " Server URL: $SERVER_URL"
Write-Host "=============================================="

# Metrics refresh interval (every 30 polls)
$metricsCounter = 0
$CpuVal = 0.0
$RamVal = 0.0

while ($true) {
    try {
        # Refresh metrics periodically (WMI calls are slow)
        if ($metricsCounter -eq 0) {
            $metrics = Get-SystemMetrics
            $CpuVal = $metrics.cpu
            $RamVal = $metrics.ram
            $DockerStatus = Get-DockerStatus
        }
        $metricsCounter = ($metricsCounter + 1) % 30

        # Build poll URL
        $pollUrl = "$SERVER_URL/api/agent/poll?" +
            "token=$([Uri]::EscapeDataString($SECRET_TOKEN))" +
            "&id=$([Uri]::EscapeDataString($AGENT_ID))" +
            "&hostname=$([Uri]::EscapeDataString($HOSTNAME))" +
            "&platform=$([Uri]::EscapeDataString($PLATFORM))" +
            "&ip=$([Uri]::EscapeDataString($IP))" +
            "&cpu=$CpuVal" +
            "&ram=$RamVal" +
            "&docker=$([Uri]::EscapeDataString($DockerStatus))"

        $response = Invoke-AgentGet -Url $pollUrl

        if ($response) {
            $commandId = Parse-JsonValue -Json $response -Key "commandId"
            $cmd       = Parse-JsonValue -Json $response -Key "cmd"
            $action    = Parse-JsonValue -Json $response -Key "action"

            if ($action -eq "kill" -and $commandId) {
                Stop-Command -CommandId $commandId
            } elseif ($commandId -and $commandId -ne "null" -and $cmd) {
                Start-CommandExecution -CommandId $commandId -Cmd $cmd
            }
        } else {
            Write-Host "Connection to server failed. Retrying in 5 seconds..."
            Start-Sleep -Seconds 5
            continue
        }

        # Process any finished background jobs
        Process-FinishedJobs -AgentId $AGENT_ID

    } catch {
        Write-Host "Unexpected error: $_. Retrying in 5 seconds..."
        Start-Sleep -Seconds 5
        continue
    }

    Start-Sleep -Seconds $POLL_INTERVAL
}
