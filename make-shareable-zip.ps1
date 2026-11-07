# Builds "Commander Table (portable).zip" next to this folder, safe to share:
#  • leaves out the data folder (your private browser profile, saved settings, the internet-play tool)
#  • leaves out logs and temporary files
#  • refuses to build if any file mentions this PC's user name, computer name or home folder
# Run:  powershell -ExecutionPolicy Bypass -File make-shareable-zip.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$zip  = Join-Path (Split-Path $root -Parent) 'Commander Table (portable).zip'
$top  = Split-Path $root -Leaf

$files = Get-ChildItem -LiteralPath $root -Recurse -File -Force | Where-Object {
  $rel = $_.FullName.Substring($root.Length + 1)
  # (public\roles holds the Kingdoms role card pictures from your own copy of the role card PDF: that art
  # belongs to Wizards of the Coast and its artists, so it stays on this PC and isn't shared)
  # (.git holds commit history with author names and emails; .claude, .github and tests are developer tooling)
  # (in a git worktree, .git is a file pointing at the main checkout)
  -not ($rel -like 'data\*' -or $rel -like '.git\*' -or $rel -eq '.git' -or $rel -like '.claude\*' -or $rel -like '.github\*' -or $rel -like 'tests\*' -or $rel -like 'tools\*' -or $rel -like '_*\*' -or $rel -like 'public\roles\*' -or $_.Name -eq 'running-url.txt' -or $_.Extension -in '.download', '.log', '.tmp', '.zip')
}

# Nothing that identifies this PC or its owner may be in the package
$needles = @($env:USERNAME, $env:COMPUTERNAME, $env:USERPROFILE, $env:USERDOMAIN) | Where-Object { $_ -and $_.Length -ge 3 } | Select-Object -Unique
$found = @()
foreach ($f in $files) {
  $bytes = [IO.File]::ReadAllBytes($f.FullName)
  $texts = [Text.Encoding]::UTF8.GetString($bytes), [Text.Encoding]::Unicode.GetString($bytes)
  foreach ($n in $needles) { if ($texts | Where-Object { $_.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) { $found += "$($f.FullName.Substring($root.Length + 1)) mentions '$n'" } }
}
if ($found) { $found | ForEach-Object { Write-Host $_ -ForegroundColor Red }; throw 'Not built: remove the personal details above first.' }

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
$fs = [IO.File]::Open($zip, 'Create')
$archive = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
foreach ($f in $files) {
  # Forward slashes, so every unzip tool (Windows, Mac, Linux) reads the paths correctly
  $entry = $archive.CreateEntry("$top/" + $f.FullName.Substring($root.Length + 1).Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal)
  $out = $entry.Open(); $in = [IO.File]::OpenRead($f.FullName); $in.CopyTo($out); $in.Dispose(); $out.Dispose()
}
$archive.Dispose(); $fs.Dispose()
Write-Host "Built $zip ($($files.Count) files, $([Math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 2)) MB). No personal details found." -ForegroundColor Green
