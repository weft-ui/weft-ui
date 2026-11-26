---
"@weft-ui/platform": patch
---

Fix `ui.confirm`, and `ui.alert` or `ui.actionSheet` without a title or message, failing on WeChat: the mini program rejects optional parameters passed as `undefined`.
