$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$hostOutput = Join-Path $projectRoot 'native-host\Plexo.BrowserHost.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /platform:anycpu /optimize+ /r:System.Web.Extensions.dll "/out:$hostOutput" (Join-Path $projectRoot 'native-host\Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native host compilation failed' }
