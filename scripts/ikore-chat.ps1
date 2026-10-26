# Ikore AI terminal chat
# Run from the repo folder:  powershell -ExecutionPolicy Bypass -File .\scripts\ikore-chat.ps1
# Save this file as "UTF-8 with BOM" so Windows PowerShell 5.1 draws the banner correctly.

param(
  [string]$Api  = "http://localhost:3001",
  [string]$Farm = "farm_bisi_ogbomoso",
  [string]$Lang = "en"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Ikore AI"

$Farms = @{ "bisi" = "farm_bisi_ogbomoso"; "ade" = "farm_ade_iseyin" }
$Langs = @("en", "yo", "pcm")
$LastRun = $null

function Show-Banner {
  Clear-Host
  $art = @(
    "  ▀▄            ▄▀              ▀▄",
    "  ██╗██╗  ██╗ ██████╗ ██████╗ ███████╗",
    "  ██║██║ ██╔╝██╔═══██╗██╔══██╗██╔════╝",
    "  ██║█████╔╝ ██║   ██║██████╔╝█████╗  ",
    "  ██║██╔═██╗ ██║   ██║██╔══██╗██╔══╝  ",
    "  ██║██║  ██╗╚██████╔╝██║  ██║███████╗",
    "  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝"
  )
  $colors = @("Yellow", "Yellow", "Yellow", "Green", "Green", "DarkGreen", "DarkGreen")
  Write-Host ""
  for ($i = 0; $i -lt $art.Count; $i++) { Write-Host $art[$i] -ForegroundColor $colors[$i] }
  Write-Host ""
  Write-Host "  Ìkórè AI  ·  maize advice for Oyo farmers, in their own language" -ForegroundColor White
  Write-Host "  Zetaris data · Meterless H-MEM memory · Nemotron via Nightshift" -ForegroundColor DarkGray
  Write-Host ""
}

function Show-Help {
  Write-Host "  Type a question and press Enter. Commands:" -ForegroundColor DarkGray
  Write-Host "    /farm bisi | ade     switch farm" -ForegroundColor DarkGray
  Write-Host "    /lang en | yo | pcm  switch reply language" -ForegroundColor DarkGray
  Write-Host "    /trace               show the steps of the last answer" -ForegroundColor DarkGray
  Write-Host "    /health              check the live stack" -ForegroundColor DarkGray
  Write-Host "    /clear               redraw the screen" -ForegroundColor DarkGray
  Write-Host "    /exit                quit" -ForegroundColor DarkGray
  Write-Host ""
}

function Show-Health {
  try {
    $h = Invoke-RestMethod "$Api/api/health" -TimeoutSec 15
    $mode = if ($h.sample_mode) { "sample" } else { "live" }
    $c = if ($h.ok -and -not $h.sample_mode) { "Green" } else { "Yellow" }
    Write-Host ("  ● {0}   Nightshift: {1}   Zetaris: {2}" -f $mode, $h.nightshift_configured, $h.zetaris_configured) -ForegroundColor $c
  } catch {
    Write-Host "  ● Ikore is not reachable at $Api. Is npm run dev running on 3001?" -ForegroundColor Red
  }
  Write-Host ""
}

function Show-Trace {
  if (-not $LastRun -or -not $LastRun.trace_file -or -not (Test-Path $LastRun.trace_file)) {
    Write-Host "  No trace yet. Ask a question first (and run this from the repo folder)." -ForegroundColor DarkYellow
    return
  }
  Get-Content $LastRun.trace_file -Encoding UTF8 |
    ForEach-Object { ($_ | ConvertFrom-Json) | Select-Object step, component, status, output_summary } |
    Format-Table -Wrap | Out-Host
}

function Ask($q) {
  $body = @{ question = $q; farm_id = $Farm; lang = $Lang } | ConvertTo-Json
  Write-Host "  thinking..." -ForegroundColor DarkGray -NoNewline
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$Api/api/run" `
         -ContentType "application/json; charset=utf-8" `
         -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 300
  } catch {
    Write-Host "`r  Request failed: $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
  Write-Host "`r              `r" -NoNewline

  $model = ""
  if ($r.trace_file -and (Test-Path $r.trace_file)) {
    $llm = Get-Content $r.trace_file -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json } |
           Where-Object { $_.responded_model } | Select-Object -Last 1
    if ($llm) { $model = $llm.responded_model }
  }
  $kind = switch ($r.intent) {
    "maize_agronomy"  { "general guidance" }
    "recall_previous" { "from memory" }
    "out_of_scope"    { "out of scope" }
    default           { "data-checked" }
  }

  Write-Host ""
  Write-Host ("  ikore  " ) -ForegroundColor Green -NoNewline
  Write-Host ("[{0} · {1} · {2}{3}]" -f $r.intent, $kind, $r.mode, $(if ($model) { " · $model" } else { "" })) -ForegroundColor DarkGray
  ($r.reply -split "`n") | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
  if ($r.fallback_reason) { Write-Host "  (fallback: $($r.fallback_reason))" -ForegroundColor DarkYellow }
  Write-Host ""
  return $r
}

Show-Banner
Show-Health
Show-Help

while ($true) {
  $short = ($Farms.GetEnumerator() | Where-Object { $_.Value -eq $Farm } | Select-Object -First 1).Key
  if (-not $short) { $short = $Farm }
  Write-Host "  you " -ForegroundColor Yellow -NoNewline
  Write-Host "($short · $Lang) > " -ForegroundColor DarkGray -NoNewline
  $q = Read-Host
  if ([string]::IsNullOrWhiteSpace($q)) { continue }
  $q = $q.Trim()

  switch -Regex ($q) {
    '^/(exit|quit)$' { Write-Host "  O dàbọ̀. Good harvest." -ForegroundColor Green; return }
    '^/help$'        { Show-Help; continue }
    '^/clear$'       { Show-Banner; continue }
    '^/health$'      { Show-Health; continue }
    '^/trace$'       { Show-Trace; continue }
    '^/farm\s+(\w+)$' {
      $k = $Matches[1].ToLower()
      if ($Farms.ContainsKey($k)) { $Farm = $Farms[$k]; Write-Host "  Farm set to $Farm" -ForegroundColor DarkGray }
      else { Write-Host "  Farms: bisi, ade" -ForegroundColor DarkYellow }
      continue
    }
    '^/lang\s+(\w+)$' {
      $l = $Matches[1].ToLower()
      if ($Langs -contains $l) { $Lang = $l; Write-Host "  Language set to $Lang" -ForegroundColor DarkGray }
      else { Write-Host "  Languages: en, yo, pcm" -ForegroundColor DarkYellow }
      continue
    }
    '^/' { Write-Host "  Unknown command. Type /help" -ForegroundColor DarkYellow; continue }
    default {
      $res = Ask $q
      if ($res) { $LastRun = $res }
    }
  }
}
