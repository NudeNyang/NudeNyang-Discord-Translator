param(
    [Parameter(Mandatory)][string]$ServerPath,
    [Parameter(Mandatory)][string]$ModelPath,
    [string[]]$Profiles = @('default', '8', '6', '4'),
    [ValidateRange(1, 20)][int]$Rounds = 2,
    [switch]$LongText,
    [int]$ExistingServerProcessId = 0,
    [string]$OutputPath = 'artifacts/cpu-translation-benchmark.json'
)
$ErrorActionPreference = 'Stop'
$serverFile = (Resolve-Path -LiteralPath $ServerPath).Path
$modelFile = (Resolve-Path -LiteralPath $ModelPath).Path
$outputFile = [IO.Path]::GetFullPath($OutputPath)
$null = New-Item -ItemType Directory -Path (Split-Path -Parent $outputFile) -Force
$logicalCpus = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$sources = @(
    'The game is loading. I will join your team in a minute.',
    'Please check the audio settings before we start. If the microphone does not work, reconnect it and try again.',
    "Today's plan`n`n1. Meet at the entrance at eight.`n2. Explore the new area together.`n`nPlease bring enough food and water for everyone."
)
if ($LongText) {
    $sources = @('We have finished testing the new update, and most features are working well. However, some players reported that the voice chat becomes quiet after changing channels. Please check your microphone settings before joining the group. We will meet near the main entrance at eight tonight, explore the northern area, and return before midnight. If you arrive late, send us a message and wait near the bridge. Bring enough food and water, and remember to save your progress before leaving the game.')
}
$results = @()
if ($ExistingServerProcessId) { $Profiles = @('installed') }
foreach ($profile in $Profiles) {
    $ownsServer = $ExistingServerProcessId -eq 0
    if (!$ownsServer) {
        $server = Get-Process -Id $ExistingServerProcessId
        if ($server.Path -ne $serverFile) { throw 'Existing process is not the selected model executable' }
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ExistingServerProcessId"
        if ($processInfo.CommandLine -notmatch '--host 127\.0\.0\.1 --port (\d+)') { throw 'Expected a loopback model server' }
        $port = [int]$Matches[1]
    } else {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $port = $listener.LocalEndpoint.Port
        $listener.Stop()
        $arguments = @('--model', ('"' + $modelFile + '"'), '--host', '127.0.0.1', '--port', "$port", '--ctx-size', '2048', '--parallel', '1', '--device', 'none', '--gpu-layers', '0', '--no-op-offload', '--no-webui')
        if ($profile -ne 'default') {
            $threadCount = [int]$profile
            if ($threadCount -lt 1 -or $threadCount -gt $logicalCpus) { throw 'Invalid thread count' }
            $arguments += @('--threads', "$threadCount", '--threads-batch', "$threadCount", '--poll', '0', '--poll-batch', '0', '--prio', '-1')
        }
        $server = Start-Process -FilePath $serverFile -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput "$outputFile.$profile.stdout.log" -RedirectStandardError "$outputFile.$profile.stderr.log"
    }
    try {
        $ready = $false
        for ($attempt = 0; $attempt -lt 120; $attempt++) {
            if ($server.HasExited) { throw "Benchmark server exited: $profile" }
            try { $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 1; $ready = $health.status -eq 'ok' } catch {}
            if ($ready) { break }
            Start-Sleep -Milliseconds 250
        }
        if (!$ready) { throw 'Benchmark server did not become ready' }
        for ($round = 0; $round -le $Rounds; $round++) {
            for ($index = 0; $index -lt $sources.Count; $index++) {
                if ($round -eq 0 -and $index -gt 0) { continue }
                $body = @{ messages = @(@{role='user'; content="Translate the following English text into Korean. Preserve meaning, tone, numbers and paragraph breaks. Output only the translation.`n`n$($sources[$index])"}); temperature=0; seed=42; max_tokens=256; stream=$false; cache_prompt=$false } | ConvertTo-Json -Depth 5
                $server.Refresh()
                $cpuBefore = $server.TotalProcessorTime.TotalSeconds
                $watch = [Diagnostics.Stopwatch]::StartNew()
                $response = Invoke-RestMethod "http://127.0.0.1:$port/v1/chat/completions" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 90
                $watch.Stop()
                $server.Refresh()
                if ($round -eq 0) { continue }
                $cpuSeconds = $server.TotalProcessorTime.TotalSeconds - $cpuBefore
                $results += [pscustomobject]@{profile=$profile; round=$round; sample=$index; seconds=$watch.Elapsed.TotalSeconds; cpuSeconds=$cpuSeconds; cpuPercent=100*$cpuSeconds/$watch.Elapsed.TotalSeconds/$logicalCpus; output=$response.choices[0].message.content; finishReason=$response.choices[0].finish_reason}
            }
        }
    } finally {
        if ($ownsServer -and !$server.HasExited) { $server.Kill(); $server.WaitForExit() }
        $server.Dispose()
    }
    [pscustomobject]@{profile=$profile; meanSeconds=($results | Where-Object profile -eq $profile | Measure-Object seconds -Average).Average; meanCPU=($results | Where-Object profile -eq $profile | Measure-Object cpuPercent -Average).Average} | ConvertTo-Json -Compress
    $results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputFile -Encoding utf8
}
