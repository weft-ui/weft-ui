---
"@weft-ui/vite": patch
---

Remove the WeChat `tabBar` and `subPackages` entries from `app.json` when the program no longer declares tabs or sub-packages, instead of leaving a tab bar without a list.
