console.log(`launch ${__weft.launch}`);
__weft.on("lifecycle", () => console.log("old handler"));
__weft.on("lifecycle", json => {
  console.log(`signal ${json}`);
  queueMicrotask(() => console.log("signal microtask"));
});
__weft.open("00000000000000ab", () => true, __weft.protocol, (scope, point, start, end) => {
  console.log(`window ${scope} ${point} ${start} ${end}`);
  queueMicrotask(() => console.log("window microtask"));
});
