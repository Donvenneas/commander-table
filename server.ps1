# Commander Table - local server
# Serves the app, proxies deck-site requests (they block browser CORS) and caches the
# Magic: The Gathering Comprehensive Rules downloaded from Wizards of the Coast.
param([int]$Port = 8777, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root  = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'public'))
$Cache = Join-Path $PSScriptRoot 'cache'
if (-not (Test-Path $Cache)) { New-Item -ItemType Directory $Cache | Out-Null }

$AllowedHosts = @(
  'archidekt.com', 'www.archidekt.com',
  'api2.moxfield.com', 'api.moxfield.com', 'moxfield.com', 'www.moxfield.com',
  'www.mtggoldfish.com', 'mtggoldfish.com',
  'tappedout.net', 'deckstats.net',
  'magic.wizards.com', 'media.wizards.com',
  'cedh-decklist-database.com', 'www.cedh-decklist-database.com',
  'cubecobra.com', 'www.cubecobra.com'
)
# (item 204) An honest client name for every site: the game never poses as a web browser
$UA = 'CommanderTable/1.0 (local deck viewer; no browser)'
# (item 201) What the game's pages may load and call: their own files, Scryfall, Commander Spellbook and MTGJSON
$CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.scryfall.io; media-src 'self' data: blob:; connect-src 'self' https://api.scryfall.com https://*.scryfall.io https://backend.commanderspellbook.com https://mtgjson.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
# (item 202) The most a friend's page may send in one request (a 200,000-character decklist fits)
$FriendBodyMax = 262144
$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.json' = 'application/json'
  '.svg'  = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'
  '.jpg'  = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'
}

# ListedOnly (item 202): the deck-site proxy follows a redirect only to another https address on the allowed list
function Get-Remote([string]$Url, [switch]$ListedOnly) {
  for ($hop = 0; $ListedOnly -and $hop -lt 5; $hop++) {
    $probe = [Net.HttpWebRequest]::Create($Url)
    $probe.UserAgent = $UA; $probe.Method = 'HEAD'; $probe.AllowAutoRedirect = $false; $probe.Timeout = 30000
    $pr = $null
    try { $pr = $probe.GetResponse() }
    catch {
      $ex = $_.Exception
      while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }
      if ($ex -and $ex.Response) { $pr = $ex.Response } else { break }
    }
    $code = [int]$pr.StatusCode; $loc = $pr.Headers['Location']; $pr.Close()
    if ($code -lt 300 -or $code -gt 399 -or -not $loc) { break }
    $next = $null
    if (-not [Uri]::TryCreate([Uri]$Url, $loc, [ref]$next) -or $next.Scheme -ne 'https' -or $AllowedHosts -notcontains $next.Host.ToLower()) {
      return @{ Status = 400; Type = 'text/plain; charset=utf-8'; Body = [Text.Encoding]::UTF8.GetBytes('That site sent the request to an address that is not on the allowed deck-site list.') }
    }
    $Url = $next.AbsoluteUri
  }
  $req = [Net.HttpWebRequest]::Create($Url)
  if ($ListedOnly) { $req.AllowAutoRedirect = $false }
  $req.UserAgent = $UA
  $req.Accept = 'application/json, text/plain, text/html;q=0.9, */*;q=0.8'
  $req.Headers.Add('Accept-Language', 'en-US,en;q=0.9')
  $req.Timeout = 30000
  $req.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
  $resp = $null
  try { $resp = $req.GetResponse() }
  catch {
    $ex = $_.Exception
    while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }
    if ($ex -and $ex.Response) { $resp = $ex.Response } else { throw }
  }
  try {
    $ms = New-Object IO.MemoryStream
    $resp.GetResponseStream().CopyTo($ms)
    $type = $resp.ContentType
    if (-not $type) { $type = 'application/octet-stream' }
    return @{ Status = [int]$resp.StatusCode; Type = $type; Body = $ms.ToArray() }
  } finally { $resp.Close() }
}

function Get-Rules {
  $file = Join-Path $Cache 'MagicCompRules.txt'
  $srcFile = Join-Path $Cache 'rules-source.txt'
  if ((Test-Path $file) -and ((Get-Date) - (Get-Item $file).LastWriteTime).TotalDays -lt 7) {
    return @{ Body = [IO.File]::ReadAllBytes($file); Source = (Get-Content $srcFile -ErrorAction SilentlyContinue | Select-Object -First 1) }
  }
  try {
    $page = Get-Remote 'https://magic.wizards.com/en/rules'
    $html = [Text.Encoding]::UTF8.GetString($page.Body)
    $m = [regex]::Match($html, 'https://media\.wizards\.com/[^"''<>]+?\.txt')
    if (-not $m.Success) { throw 'Could not find the Comprehensive Rules .txt link on magic.wizards.com/en/rules' }
    $txtUrl = $m.Value -replace ' ', '%20'
    Write-Host "Downloading Comprehensive Rules: $txtUrl"
    $r = Get-Remote $txtUrl
    if ($r.Status -ne 200) { throw "Rules download failed with HTTP $($r.Status)" }
    [IO.File]::WriteAllBytes($file, $r.Body)
    Set-Content -Path $srcFile -Value $txtUrl -Encoding UTF8
    return @{ Body = $r.Body; Source = $txtUrl }
  } catch {
    if (Test-Path $file) { return @{ Body = [IO.File]::ReadAllBytes($file); Source = (Get-Content $srcFile -ErrorAction SilentlyContinue | Select-Object -First 1) } }
    throw
  }
}

function Send-Response($Ctx, [int]$Status, [string]$Type, [byte[]]$Body, [hashtable]$Headers = @{}) {
  $res = $Ctx.Response
  try {
    $res.StatusCode = $Status
    $res.ContentType = $Type
    $res.Headers['Cache-Control'] = 'no-store'
    $res.Headers['X-Content-Type-Options'] = 'nosniff'
    if ($Type -and $Type.StartsWith('text/html')) { $res.Headers['Content-Security-Policy'] = $CSP }
    foreach ($k in $Headers.Keys) { $res.Headers[$k] = [string]$Headers[$k] }
    $res.ContentLength64 = $Body.Length
    $res.OutputStream.Write($Body, 0, $Body.Length)
  } catch { } finally { $res.Close() }
}

function Send-Text($Ctx, [int]$Status, [string]$Text) {
  Send-Response $Ctx $Status 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($Text))
}

# ---------- online seats (same protocol as Commander Table.exe and server.py)
# The game runs in the host's browser. Friends' pages poll their view of the table and post answers.
# Friends connect to a plain TCP listener on 8800-8820 (an HttpListener on the network would need admin
# rights); host-only calls are accepted only from this PC.
$Room = @{ Code = $null; Seats = @{}; Chat = New-Object System.Collections.ArrayList; ChatId = 0; Fails = New-Object System.Collections.ArrayList }
$Lan = $null; $LanPort = 0
$Tunnel = @{ Status = 'off'; Url = ''; Error = ''; Proc = $null; Log = '' }
# Each seat (and the spectators' view) has its own secret join code, so a friend can't open another
# seat's view (and see that hand) by changing the seat number in their link. 10 characters from 32
# letters and digits (no 0/O, 1/I) is about 50 bits; wrong codes are also limited to 30 a minute.
$Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
function New-SeatKey { $b = New-Object byte[] 10; $Rng.GetBytes($b); -join ($b | ForEach-Object { 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[$_ % 32] }) }
function New-Seat { @{ State = 'null'; Question = 'null'; Answer = $null; Name = ''; Seen = $null; LastChat = [DateTime]::MinValue; UndoAsk = $null; UndoReply = $null; Deck = $null; Key = (New-SeatKey) } }
function JsStr([string]$s) { if ($null -eq $s) { $s = '' }; '"' + ($s -replace '\\', '\\' -replace '"', '\"' -replace "`n", '\n' -replace "`r", '' -replace '[\x00-\x1f]', ' ') + '"' }
# The image folder's cap: data\image-cache-mb.txt (set in the app), else 400 MB; the oldest go when it's over
$script:ImagesSaved = 0
function Get-ImageCap {
  $f = Join-Path $PSScriptRoot 'data\image-cache-mb.txt'; $mb = 0
  if ((Test-Path $f) -and [int]::TryParse(([IO.File]::ReadAllText($f)).Trim(), [ref]$mb)) { return [long][Math]::Max(100, [Math]::Min(20000, $mb)) * 1MB }
  return 400MB
}
function Trim-Images {
  $dir = Join-Path $PSScriptRoot 'data\images'
  if (-not (Test-Path $dir)) { return }
  $files = @(Get-ChildItem -LiteralPath $dir -File | Sort-Object LastWriteTimeUtc)
  $total = ($files | Measure-Object -Property Length -Sum).Sum; $cap = Get-ImageCap
  if ($total -le $cap) { return }
  foreach ($f in $files) { if ($total -le $cap * 0.8) { break }; $total -= $f.Length; try { Remove-Item -LiteralPath $f.FullName } catch { } }
}
function Start-Lan {
  if ($script:Lan) { return $true }
  foreach ($port in 8800..8820) {
    try { $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $port); $l.Start(); $script:Lan = $l; $script:LanPort = $port; return $true } catch { }
  }
  return $false
}
function Room-Call([string]$method, [string]$action, [int]$seat, [string]$code, [string]$body, [bool]$local) {
  $friend = $action -in 'view', 'hello' -or ($action -in 'answer', 'chat', 'undo', 'deck' -and $method -eq 'POST')
  if ($friend) {
    $s = $Room.Seats[$seat]
    if (-not $Room.Code -or -not $s -or "$code".ToUpperInvariant() -cne $s.Key) {
      $now = Get-Date
      foreach ($t in @($Room.Fails)) { if (($now - $t).TotalSeconds -ge 60) { $Room.Fails.Remove($t) } }
      [void]$Room.Fails.Add($now)
      if ($Room.Fails.Count -gt 30) { return @(429, '{"error":"Too many wrong join codes. Wait a minute and try again."}') }
      return @(403, '{"error":"This game isn''t open, or the link is out of date."}')
    }
    if ($seat -ge 0) { $s.Seen = Get-Date }
    switch ($action) {
      'view' { $r = $s.UndoReply; $s.UndoReply = $null; return @(200, "{`"state`":$($s.State),`"question`":$($s.Question),`"undoReply`":$(if ($r) { JsStr $r } else { 'null' })}") }
      'hello' { if ($seat -ge 0) { $s.Name = $body.Substring(0, [Math]::Min(40, $body.Length)) }; return @(200, '{}') }
      'undo' { if ($seat -ge 0) { $s.UndoAsk = Get-Date; $s.UndoReply = $null }; return @(200, '{}') }
      'deck' { if ($seat -ge 0 -and $body.Length -le 200000) { $s.Deck = $body }; return @(200, '{}') }
      'chat' {
        if (((Get-Date) - $s.LastChat).TotalSeconds -lt 1) { return @(429, '{"error":"Slow down"}') }
        $s.LastChat = Get-Date
        $nl = $body.IndexOf("`n")
        $who = if ($nl -gt 0) { $body.Substring(0, [Math]::Min($nl, 24)) } else { '' }
        $text = (($(if ($nl -ge 0) { $body.Substring($nl + 1) } else { $body })) -replace '[\x00-\x1f]', ' ').Trim()
        if ($text.Length -gt 200) { $text = $text.Substring(0, 200) }
        if ($text) {
          $Room.ChatId++
          [void]$Room.Chat.Add("{`"id`":$($Room.ChatId),`"seat`":$seat,`"name`":$(JsStr ($who -replace '[\x00-\x1f]', ' ')),`"text`":$(JsStr $text)}")
          while ($Room.Chat.Count -gt 50) { $Room.Chat.RemoveAt(0) }
        }
        return @(200, '{}')
      }
      default { $s.Answer = $body; return @(200, '{}') }
    }
  }
  if (-not $local) { return @(403, '{"error":"Only the host can do that."}') }
  switch ($action) {
    'open' {
      if (-not (Start-Lan)) { return @(500, '{"error":"Couldn''t open a port for other players (8800-8820 are busy)."}') }
      $Room.Code = ([Guid]::NewGuid().ToString('N').Substring(0, 6)).ToUpper()
      $Room.Seats = @{}; $Room.Chat.Clear(); $Room.Fails.Clear()
      # ("seat" or "seat=KEY": a resumed game reopens its room with the same keys, so friends' links still work)
      foreach ($part in $body.Split(',')) {
        $bits = $part.Trim().Split('='); $n = 0
        if ([int]::TryParse($bits[0], [ref]$n)) { $s = New-Seat; if ($bits.Count -gt 1 -and $bits[1] -cmatch '^[A-HJ-NP-Z2-9]{10}$') { $s.Key = $bits[1] }; $Room.Seats[$n] = $s }
      }
      $keys = foreach ($k in $Room.Seats.Keys) { "$(JsStr "$k"):$(JsStr $Room.Seats[$k].Key)" }
      $ips = [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not [Net.IPAddress]::IsLoopback($_) -and -not $_.ToString().StartsWith('169.254.') } | ForEach-Object { JsStr $_.ToString() }
      return @(200, "{`"code`":$(JsStr $Room.Code),`"keys`":{$($keys -join ',')},`"port`":$LanPort,`"ips`":[$($ips -join ',')]}")
    }
    'close' { $Room.Code = $null; $Room.Seats = @{}; $Room.Chat.Clear(); return @(200, '{}') }
    'tunnel' { if ($method -eq 'POST') { Start-Tunnel }; Update-Tunnel; return @(200, "{`"status`":$(JsStr $Tunnel.Status),`"url`":$(JsStr $Tunnel.Url),`"error`":$(JsStr $Tunnel.Error)}") }
    # (hand a seat to someone else: a new key, so the old link stops working)
    'rekey' { $s = $Room.Seats[$seat]; if (-not $s) { return @(404, '{"error":"No such seat."}') }; $s.Key = New-SeatKey; $s.Name = ''; $s.Seen = $null; $s.Answer = $null; return @(200, "{`"key`":$(JsStr $s.Key)}") }
    'state' { if ($Room.Seats[$seat]) { $Room.Seats[$seat].State = if ($body) { $body } else { 'null' } }; return @(200, '{}') }
    'ask' { if ($Room.Seats[$seat]) { $Room.Seats[$seat].Question = if ($body) { $body } else { 'null' }; $Room.Seats[$seat].Answer = $null }; return @(200, '{}') }
    'deck' { $s = $Room.Seats[$seat]; if ($s -and $null -ne $s.Deck) { $d = $s.Deck; $s.Deck = $null; return @(200, $d) }; return @(200, '') }
    'undoack' { if ($Room.Seats[$seat]) { $Room.Seats[$seat].UndoAsk = $null; $Room.Seats[$seat].UndoReply = if ($body -eq 'yes') { 'allowed' } else { 'declined' } }; return @(200, '{}') }
    'answer' { $s = $Room.Seats[$seat]; if (-not $s -or $null -eq $s.Answer) { return @(200, 'null') }; $a = $s.Answer; $s.Answer = $null; return @(200, $a) }
    'status' {
      $parts = foreach ($k in $Room.Seats.Keys) {
        if ($k -lt 0) { continue }
        $v = $Room.Seats[$k]
        $seen = if ($v.Seen) { [int]((Get-Date) - $v.Seen).TotalSeconds } else { -1 }
        $undo = if ($v.UndoAsk) { [int]((Get-Date) - $v.UndoAsk).TotalSeconds } else { -1 }
        "`"$k`":{`"name`":$(JsStr $v.Name),`"seen`":$seen,`"undo`":$undo,`"deck`":$(if ($null -ne $v.Deck) { 'true' } else { 'false' })}"
      }
      return @(200, ('{' + ($parts -join ',') + '}'))
    }
    'chat' { $newer = $Room.Chat | Where-Object { [int]([regex]::Match($_, '^\{"id":(\d+)').Groups[1].Value) -gt $seat }; return @(200, ('[' + ($newer -join ',') + ']')) }
  }
  return @(404, '{"error":"unknown"}')
}

# Free Cloudflare quick tunnel for internet play (Cloudflare's official cloudflared, downloaded on first use)
function Start-Tunnel {
  if ($Tunnel.Status -in 'starting', 'on' -and $Tunnel.Proc -and -not $Tunnel.Proc.HasExited) { return }
  if (-not $Lan) { $Tunnel.Status = 'error'; $Tunnel.Error = 'Open a game with an online seat first.'; return }
  $dataDir = Join-Path $PSScriptRoot 'data'
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory $dataDir | Out-Null }
  $exe = Join-Path $dataDir 'cloudflared.exe'
  try {
    if (-not (Test-Path $exe)) {
      $Tunnel.Status = 'downloading'
      $tmp = "$exe.download"
      (New-Object Net.WebClient).DownloadFile('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', $tmp)
      # Only run it if Cloudflare signed it
      $sig = Get-AuthenticodeSignature $tmp
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Cloudflare') { Remove-Item $tmp; throw "The downloaded tunnel tool isn't signed by Cloudflare, so it wasn't used." }
      Move-Item $tmp $exe
    }
    $Tunnel.Log = Join-Path $dataDir 'tunnel.log'
    if (Test-Path $Tunnel.Log) { Remove-Item $Tunnel.Log -ErrorAction SilentlyContinue }
    $Tunnel.Proc = Start-Process -FilePath $exe -ArgumentList "tunnel --no-autoupdate --url http://localhost:$LanPort" -RedirectStandardError $Tunnel.Log -WindowStyle Hidden -PassThru
    $Tunnel.Status = 'starting'; $Tunnel.Error = ''; $Tunnel.Url = ''
    $Tunnel.Started = Get-Date
  } catch { $Tunnel.Status = 'error'; $Tunnel.Error = $_.Exception.Message }
}
function Update-Tunnel {
  if ($Tunnel.Status -ne 'starting') { return }
  if (Test-Path $Tunnel.Log) {
    $m = [regex]::Match((Get-Content $Tunnel.Log -Raw -ErrorAction SilentlyContinue) + '', 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) { $Tunnel.Url = $m.Value; $Tunnel.Status = 'on'; return }
  }
  if ($Tunnel.Proc.HasExited) { $Tunnel.Status = 'error'; $Tunnel.Error = 'The internet tunnel stopped. Try again.' }
  elseif (((Get-Date) - $Tunnel.Started).TotalSeconds -gt 30) { $Tunnel.Status = 'error'; $Tunnel.Error = "Cloudflare didn't hand out an address in time."; try { $Tunnel.Proc.Kill() } catch { } }
}

# One request from a friend's device: room calls, or the join page and the files it uses (never the host's page)
function Handle-LanClient($client) {
  try {
    $client.ReceiveTimeout = 5000; $client.SendTimeout = 5000
    $stream = $client.GetStream()
    $head = New-Object System.Collections.Generic.List[byte]
    while ($head.Count -lt 16384) {
      $x = $stream.ReadByte(); if ($x -lt 0) { break }
      $head.Add([byte]$x); $n = $head.Count
      if ($n -ge 4 -and $head[$n - 4] -eq 13 -and $head[$n - 3] -eq 10 -and $head[$n - 2] -eq 13 -and $head[$n - 1] -eq 10) { break }
    }
    $lines = [Text.Encoding]::ASCII.GetString($head.ToArray()).Split([string[]]@("`r`n"), [StringSplitOptions]::None)
    $first = $lines[0].Split(' ')
    if ($first.Count -lt 2) { return }
    $len = 0
    foreach ($l in $lines) { if ($l -match '^Content-Length:\s*(\d{1,9})') { $len = [int]$Matches[1] } }
    # (item 202) the same limit on all three servers; too much is refused, never cut short
    if ($len -gt $FriendBodyMax) {
      $no = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 413 Error`r`nContent-Type: text/plain`r`nContent-Length: 0`r`nConnection: close`r`n`r`n")
      $stream.Write($no, 0, $no.Length); return
    }
    $buf = New-Object byte[] $len
    $read = 0; while ($read -lt $len) { $k = $stream.Read($buf, $read, $len - $read); if ($k -le 0) { break }; $read += $k }
    $uri = [Uri]("http://lan" + $first[1])
    $q = [Web.HttpUtility]::ParseQueryString($uri.Query)
    $path = [Uri]::UnescapeDataString($uri.AbsolutePath)
    if ($path.StartsWith('/api/room/')) {
      $seat = 0; [void][int]::TryParse($q['seat'], [ref]$seat)
      $res = Room-Call $first[0] $path.Substring(10) $seat $q['code'] ([Text.Encoding]::UTF8.GetString($buf)) $false
      $status = $res[0]; $type = 'application/json'; $body = [Text.Encoding]::UTF8.GetBytes($res[1])
    } else {
      if ($path -eq '/') { $path = '/play.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $Root ($path.TrimStart('/') -replace '/', '\')))
      # (item 202: compared as files, so "/INDEX.HTML" or "/./index.html" is the host's page too)
      $hostPage = [IO.Path]::GetFullPath((Join-Path $Root 'index.html'))
      if ($path.StartsWith('/api/') -or $full.Equals($hostPage, [StringComparison]::OrdinalIgnoreCase) -or -not $full.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
        $status = 404; $type = 'text/plain'; $body = [Text.Encoding]::UTF8.GetBytes('Not found')
      } else {
        $status = 200; $type = $Mime[[IO.Path]::GetExtension($full).ToLower()]; if (-not $type) { $type = 'application/octet-stream' }
        $body = [IO.File]::ReadAllBytes($full)
      }
    }
    $hb = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status $(if ($status -eq 200) { 'OK' } else { 'Error' })`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff$(if ($type -and $type.StartsWith('text/html')) { "`r`nContent-Security-Policy: $CSP" })`r`nConnection: close`r`n`r`n")
    $stream.Write($hb, 0, $hb.Length); $stream.Write($body, 0, $body.Length)
  } catch { } finally { $client.Close() }
}
Add-Type -AssemblyName System.Web

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host ""
Write-Host "  Commander Table is running at http://localhost:$Port/" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""
# Open the game in the default browser, unless that's Microsoft Edge; then use another installed browser
function Open-Game([string]$url) {
  $browser = $null
  try {
    $progId = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
    $cmd = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction Stop).'(default)'
    if ($cmd -match '^\s*"([^"]+)"' -or $cmd -match '^\s*(\S+)') { $browser = $Matches[1] }
  } catch { }
  if (-not $browser -or (Split-Path $browser -Leaf) -ieq 'msedge.exe' -or -not (Test-Path $browser)) {
    $browser = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
      "$env:ProgramFiles\Mozilla Firefox\firefox.exe", "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe",
      "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
      "$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if ($browser) { Start-Process $browser "`"$url`"" }
  else { Write-Host "  Open $url in any web browser other than Microsoft Edge." -ForegroundColor Yellow }
}
if (-not $NoBrowser) { Open-Game "http://localhost:$Port/" }

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    # While waiting for the host's page, serve friends' devices too
    while (-not $task.AsyncWaitHandle.WaitOne(30)) {
      while ($Lan -and $Lan.Pending()) { Handle-LanClient $Lan.AcceptTcpClient() }
    }
    $ctx = $task.GetAwaiter().GetResult()
    $req = $ctx.Request
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    # Other websites' pages can send simple requests to localhost; only the game's own page may use /api/
    # (the browser marks cross-site requests with Origin and Sec-Fetch-Site; HttpListener already refuses
    # Host headers other than localhost, which stops DNS rebinding)
    $origin = "$($req.Headers['Origin'])".ToLower()
    $site = "$($req.Headers['Sec-Fetch-Site'])".ToLower()
    $foreign = ($origin -and $origin -ne "http://localhost:$Port" -and $origin -ne "http://127.0.0.1:$Port") -or $site -eq 'cross-site' -or $site -eq 'same-site'
    try {
      if ($path.StartsWith('/api/') -and $foreign) {
        Send-Text $ctx 403 'Only the Commander Table page on this computer can use this.'
      }
      elseif ($path.StartsWith('/api/room/')) {
        $seat = 0; [void][int]::TryParse($req.QueryString['seat'], [ref]$seat)
        $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
        $res = Room-Call $req.HttpMethod $path.Substring(10) $seat $req.QueryString['code'] $body $true
        Send-Response $ctx $res[0] 'application/json' ([Text.Encoding]::UTF8.GetBytes($res[1]))
      }
      elseif ($path -eq '/api/fetch') {
        $target = $req.QueryString['url']
        $u = $null
        if (-not [Uri]::TryCreate($target, [UriKind]::Absolute, [ref]$u) -or $u.Scheme -ne 'https' -or $AllowedHosts -notcontains $u.Host.ToLower()) {
          Send-Text $ctx 400 'That URL is not on the allowed deck-site list.'
        } else {
          $r = Get-Remote $u.AbsoluteUri -ListedOnly
          Write-Host "proxy $($r.Status) $($u.AbsoluteUri)"
          Send-Response $ctx $r.Status $r.Type $r.Body @{ 'X-Upstream-Status' = $r.Status }
        }
      }
      elseif ($path -eq '/api/exit') {
        # The custom header forces a CORS preflight, so other websites can't shut the server down
        if ($req.HttpMethod -ne 'POST' -or $req.Headers['X-Commander-Table'] -ne 'exit') {
          Send-Text $ctx 400 'Use the Exit button in the app.'
        } else {
          Send-Text $ctx 200 'Commander Table has shut down.'
          Write-Host "Exit requested from the app. Shutting down." -ForegroundColor Yellow
          $listener.Stop()
        }
      }
      elseif ($path -eq '/api/edhtop16' -and $req.HttpMethod -eq 'POST') {
        # EDHTop16's public GraphQL API only answers its own registered queries; we pass them through
        $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
        $json = $reader.ReadToEnd()
        $wr = [Net.HttpWebRequest]::Create('https://edhtop16.com/api/graphql')
        $wr.Method = 'POST'; $wr.UserAgent = $UA; $wr.ContentType = 'application/json'; $wr.Timeout = 30000
        $wr.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $s = $wr.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
        try { $resp = $wr.GetResponse() } catch { $ex = $_.Exception; while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }; if ($ex -and $ex.Response) { $resp = $ex.Response } else { throw } }
        $ms = New-Object IO.MemoryStream
        $resp.GetResponseStream().CopyTo($ms)
        $code = [int]$resp.StatusCode
        $resp.Close()
        Send-Response $ctx $code 'application/json' $ms.ToArray()
      }
      elseif ($path -eq '/api/imgcache') {
        # GET: how much the image folder holds; POST (from the app only) a new cap in MB (same as the .exe)
        $bad = $null
        if ($req.HttpMethod -eq 'POST') {
          $reader = New-Object IO.StreamReader($req.InputStream); $mb = 0
          if ($req.Headers['X-Commander-Table'] -ne 'images') { $bad = 'Use the Updates window in the app.' }
          elseif (-not [int]::TryParse($reader.ReadToEnd().Trim(), [ref]$mb)) { $bad = 'The cap is a number of MB.' }
          else {
            $dataDir = Join-Path $PSScriptRoot 'data'
            if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory $dataDir | Out-Null }
            [IO.File]::WriteAllText((Join-Path $dataDir 'image-cache-mb.txt'), [string][Math]::Max(100, [Math]::Min(20000, $mb)))
          }
        }
        if ($bad) { Send-Text $ctx 400 $bad }
        else {
          $imgDir = Join-Path $PSScriptRoot 'data\images'
          $files = if (Test-Path $imgDir) { @(Get-ChildItem -LiteralPath $imgDir -File) } else { @() }
          $bytes = ($files | Measure-Object -Property Length -Sum).Sum; if (-not $bytes) { $bytes = 0 }
          Send-Response $ctx 200 'application/json' ([Text.Encoding]::UTF8.GetBytes("{`"files`":$($files.Count),`"bytes`":$bytes,`"capMB`":$([int]((Get-ImageCap) / 1MB))}"))
        }
      }
      elseif ($path -eq '/api/img') {
        # Card images from Scryfall, kept in data\images so the table has its art offline (same as the .exe)
        $target = $req.QueryString['u']
        $u = $null
        if (-not [Uri]::TryCreate($target, [UriKind]::Absolute, [ref]$u) -or $u.Scheme -ne 'https' -or @('cards.scryfall.io', 'svgs.scryfall.io') -notcontains $u.Host.ToLower()) {
          Send-Text $ctx 400 'Only Scryfall card images are served here.'
        } else {
          $ext = [IO.Path]::GetExtension($u.AbsolutePath).ToLower()
          $type = $Mime[$ext]
          if (-not $type -or -not $type.StartsWith('image/')) { $ext = '.jpg'; $type = 'image/jpeg' }
          $sha = [Security.Cryptography.SHA1]::Create()
          $name = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($u.AbsoluteUri))) -replace '-', '').ToLower()
          $dir = Join-Path $PSScriptRoot 'data\images'
          $file = Join-Path $dir "$name$ext"
          $keep = @{ 'Cache-Control' = 'public, max-age=2592000' }
          if (Test-Path $file) { Send-Response $ctx 200 $type ([IO.File]::ReadAllBytes($file)) $keep }
          else {
            $r = Get-Remote $u.AbsoluteUri
            if ($r.Status -eq 200 -and $r.Body.Length) {
              try { if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }; [IO.File]::WriteAllBytes($file, $r.Body); $script:ImagesSaved++; if ($script:ImagesSaved % 200 -eq 0) { Trim-Images } } catch { }
              Send-Response $ctx 200 $type $r.Body $keep
            } else { Send-Response $ctx $r.Status $r.Type $r.Body }
          }
        }
      }
      elseif ($path -eq '/api/library') {
        # Deck library: plain-text decklists in data\decks (same as the .exe)
        $dir = Join-Path $PSScriptRoot 'data\decks'
        $safe = (($req.QueryString['name'] + '') -replace "[^\w ,.'&+()-]", '').Trim().TrimStart('.')
        if ($safe.Length -gt 80) { $safe = $safe.Substring(0, 80) }
        if ($req.HttpMethod -eq 'GET') {
          $items = @()
          if (Test-Path $dir) {
            foreach ($f in Get-ChildItem -LiteralPath $dir -Filter '*.txt') {
              $items += @{ name = $f.BaseName; modified = $f.LastWriteTimeUtc.ToString('o'); text = [IO.File]::ReadAllText($f.FullName) }
            }
          }
          $json = if ($items.Count) { ConvertTo-Json -InputObject @($items) -Compress } else { '[]' }
          Send-Response $ctx 200 'application/json' ([Text.Encoding]::UTF8.GetBytes($json))
        } elseif ($req.Headers['X-Commander-Table'] -ne 'library') {
          Send-Text $ctx 400 'Use the deck library in the app.'
        } elseif (-not $safe) {
          Send-Text $ctx 400 'The deck needs a name.'
        } elseif ($req.HttpMethod -eq 'POST') {
          $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
          if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
          [IO.File]::WriteAllText((Join-Path $dir "$safe.txt"), $body, (New-Object Text.UTF8Encoding($false)))
          Send-Response $ctx 200 'application/json' ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ name = $safe } -Compress)))
        } elseif ($req.HttpMethod -eq 'DELETE') {
          $file = Join-Path $dir "$safe.txt"
          if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
          Send-Response $ctx 200 'application/json' ([Text.Encoding]::UTF8.GetBytes('{}'))
        } else { Send-Text $ctx 405 'Use GET, POST or DELETE.' }
      }
      elseif ($path -eq '/api/update') {
        # Updates, only when asked (same as the .exe): download a zip from the address the user chose and
        # copy its files over this folder, never touching data\, backing up every replaced file first
        $udir = Join-Path $PSScriptRoot 'data\update'
        $urlFile = Join-Path $udir 'source-url.txt'; $zipFile = Join-Path $udir 'download.zip'
        $verFile = Join-Path $PSScriptRoot 'VERSION'
        $local = if (Test-Path $verFile) { (Get-Content $verFile -Raw).Trim() } else { 'unknown' }
        $inspect = {
          param($file)
          Add-Type -AssemblyName System.IO.Compression.FileSystem
          $z = [IO.Compression.ZipFile]::OpenRead($file)
          try {
            $names = $z.Entries | ForEach-Object { $_.FullName.Replace('\', '/') }
            $hit = $names | Where-Object { $_.EndsWith('public/index.html') } | Sort-Object Length | Select-Object -First 1
            if (-not $hit) { return @{ Error = "That zip doesn't look like Commander Table (no public/index.html in it)." } }
            $prefix = $hit.Substring(0, $hit.Length - 'public/index.html'.Length)
            if ($prefix.Split('/').Count -gt 2) { return @{ Error = "That zip doesn't look like Commander Table." } }
            $files = $z.Entries | Where-Object { $n = $_.FullName.Replace('\', '/'); $n.StartsWith($prefix) -and -not $n.EndsWith('/') -and -not $n.Substring($prefix.Length).StartsWith('data/') }
            if ($files | Where-Object { $_.FullName -match '\.\./|:' }) { return @{ Error = 'That zip contains unsafe file paths, so it was not used.' } }
            $v = 'unknown'
            $ve = $z.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq "${prefix}VERSION" } | Select-Object -First 1
            if ($ve) { $r = New-Object IO.StreamReader($ve.Open()); $v = $r.ReadToEnd().Trim(); $r.Dispose() }
            return @{ Prefix = $prefix; Version = $v; Count = @($files).Count }
          } finally { $z.Dispose() }
        }
        if ($req.HttpMethod -eq 'GET') {
          $saved = if (Test-Path $urlFile) { (Get-Content $urlFile -Raw).Trim() } else { '' }
          Send-Response $ctx 200 'application/json' ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ version = $local; url = $saved } -Compress)))
        } elseif ($req.HttpMethod -ne 'POST' -or $req.Headers['X-Commander-Table'] -ne 'update') {
          Send-Text $ctx 400 'Use the Updates window in the app.'
        } elseif ($req.QueryString['step'] -eq 'check') {
          $url = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd().Trim()
          $u = $null
          if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$u) -or $u.Scheme -ne 'https') { Send-Text $ctx 400 'The update address must start with https://' }
          else {
            if (-not (Test-Path $udir)) { New-Item -ItemType Directory $udir | Out-Null }
            Set-Content -Path $urlFile -Value $u.AbsoluteUri -Encoding UTF8
            $r = Get-Remote $u.AbsoluteUri
            if ($r.Status -ne 200) { Send-Text $ctx 502 "The update address answered HTTP $($r.Status)." }
            elseif ($r.Body.Length -lt 4 -or $r.Body[0] -ne 80 -or $r.Body[1] -ne 75) { Send-Text $ctx 400 "That address didn't give a .zip file." }
            else {
              # (item 183) the zip's SHA-256, checked against a published "<address>.sha256" when there is one
              $digest = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($r.Body)) -replace '-', '').ToLower()
              $s = Get-Remote ($u.AbsoluteUri + '.sha256')
              $published = ''
              if ($s.Status -eq 200 -and ([Text.Encoding]::UTF8.GetString($s.Body) -match '\b([0-9a-fA-F]{64})\b')) { $published = $Matches[1].ToLower() }
              if ($published -and $published -ne $digest) { Send-Text $ctx 400 "The download doesn't match its published checksum (SHA-256 $($digest.Substring(0, 16))…, expected $($published.Substring(0, 16))…). Nothing was installed." }
              else {
                [IO.File]::WriteAllBytes($zipFile, $r.Body)
                $info = & $inspect $zipFile
                if ($info.Error) { Remove-Item -LiteralPath $zipFile; Send-Text $ctx 400 $info.Error }
                else { Send-Response $ctx 200 'application/json' ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ version = $info.Version; current = $local; files = $info.Count; size = $r.Body.Length; sha256 = $digest; verified = [bool]$published } -Compress))) }
              }
            }
          }
        } elseif ($req.QueryString['step'] -eq 'apply') {
          if (-not (Test-Path $zipFile)) { Send-Text $ctx 400 'Check for an update first.' }
          else {
            $info = & $inspect $zipFile
            if ($info.Error) { Send-Text $ctx 400 $info.Error }
            else {
              $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
              $backup = Join-Path $udir "backup-$stamp"
              $rootFull = [IO.Path]::GetFullPath($PSScriptRoot)
              $changed = 0
              $z = [IO.Compression.ZipFile]::OpenRead($zipFile)
              try {
                foreach ($e in $z.Entries) {
                  $n = $e.FullName.Replace('\', '/')
                  if (-not $n.StartsWith($info.Prefix) -or $n.EndsWith('/')) { continue }
                  $rel = $n.Substring($info.Prefix.Length)
                  if (-not $rel -or $rel.StartsWith('data/')) { continue }
                  $target = [IO.Path]::GetFullPath((Join-Path $rootFull ($rel -replace '/', '\')))
                  if (-not $target.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { continue }
                  $ms = New-Object IO.MemoryStream; $s = $e.Open(); $s.CopyTo($ms); $s.Dispose(); $bytes = $ms.ToArray()
                  if (Test-Path -LiteralPath $target) {
                    $old = [IO.File]::ReadAllBytes($target)
                    if ([Convert]::ToBase64String($old) -eq [Convert]::ToBase64String($bytes)) { continue }
                    $b = Join-Path $backup ($rel -replace '/', '\')
                    New-Item -ItemType Directory -Force (Split-Path $b) | Out-Null
                    [IO.File]::WriteAllBytes($b, $old)
                  }
                  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
                  try { [IO.File]::WriteAllBytes($target, $bytes); $changed++ } catch { Write-Host "Skipped $rel (in use)" -ForegroundColor Yellow }
                }
              } finally { $z.Dispose() }
              Remove-Item -LiteralPath $zipFile
              $bk = if ($changed) { "data\update\backup-$stamp" } else { '' }
              Send-Response $ctx 200 'application/json' ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ changed = $changed; version = $local; backup = $bk } -Compress)))
            }
          }
        } else { Send-Text $ctx 400 'Unknown step.' }
      }
      elseif ($path -eq '/api/rules') {
        $rules = Get-Rules
        Send-Response $ctx 200 'text/plain' $rules.Body @{ 'X-Rules-Source' = $rules.Source }
      }
      else {
        if ($path -eq '/') { $path = '/index.html' }
        $full = [IO.Path]::GetFullPath((Join-Path $Root ($path.TrimStart('/') -replace '/', '\')))
        if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
          Send-Text $ctx 404 'Not found'
        } else {
          $type = $Mime[[IO.Path]::GetExtension($full).ToLower()]
          if (-not $type) { $type = 'application/octet-stream' }
          Send-Response $ctx 200 $type ([IO.File]::ReadAllBytes($full))
        }
      }
    } catch {
      Write-Host "error $path : $($_.Exception.Message)" -ForegroundColor Red
      Send-Text $ctx 502 $_.Exception.Message
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
  if ($Lan) { $Lan.Stop() }
  # The tunnel never outlives the server
  if ($Tunnel.Proc -and -not $Tunnel.Proc.HasExited) { try { $Tunnel.Proc.Kill() } catch { } }
}
