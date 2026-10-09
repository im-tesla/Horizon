param([Parameter(Mandatory)][string]$Archive, [Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
# Some upstream release assets contain a second ZIP with the actual runtime.
$nested = Get-ChildItem -LiteralPath $Destination -Filter '*.zip' -File
if ($nested.Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $Destination 'mpv.exe'))) {
    Expand-Archive -LiteralPath $nested[0].FullName -DestinationPath $Destination -Force
    Remove-Item -LiteralPath $nested[0].FullName
}
