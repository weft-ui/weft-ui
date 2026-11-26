# Run on the Parallels guest through /tmp/weft-win.sh, after /tmp/win-sync.ps1.
$checkout = 'C:\weft\repo'
$hostCheckout = '\\Mac\Home\Documents\Code\Projects\weft-ui'
# The existing scheduled task can run even when the guest rejects re-registering it.
& C:\weft\interactive.ps1 -Command "`$env:WEFT_SHOT_PAGES = '$env:WEFT_SHOT_PAGES'; cd $checkout; pnpm --filter example shot:windows" -Timeout 900
if ((Get-Content C:\weft\interactive.log -Tail 1) -ne 'exit 0') { exit 1 }
Copy-Item "$checkout\example\screenshots\actual\windows\*.png" "$hostCheckout\example\screenshots\actual\windows" -ErrorAction Stop
