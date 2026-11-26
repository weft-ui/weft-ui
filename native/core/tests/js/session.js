__weft.open("00000000000000ab", (scope, slot, payload) => {
  console.log(`dispatch ${scope} ${slot} ${typeof payload} ${String(payload)}`);
  if (payload === "close") __weft.close();
  return payload !== "reject";
}, 3, () => {});
// One batch: `create 7 0`, written into the middle of a larger buffer.
const bytes = new Uint8Array(16);
bytes.set([3, 1, 7, 0, 0, 0, 0, 0, 0, 0], 3);
__weft.commit(bytes.buffer, 3, 10);
