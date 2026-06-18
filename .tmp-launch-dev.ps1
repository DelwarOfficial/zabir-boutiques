$workdir = "D:\Antigravity\zabir-boutiques"
$npm = "C:\Program Files\nodejs\npm.cmd"
if (-not (Test-Path $npm)) { $npm = (Get-Command npm.cmd -ErrorAction Stop).Source }
Remove-Item "$workdir\.tmp-dev.log" -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "cd /d `"$workdir`" && `"$npm`" run dev" -WorkingDirectory $workdir -WindowStyle Normal -PassThru
"LAUNCHED dev server in NEW CMD WINDOW. PID: $($p.Id)"
Start-Sleep -Seconds 3
"New window should show: astro ready on http://localhost:4321"
