function expectThrows(label, fn) {
  try {
    fn();
  } catch (_err) {
    return;
  }
  throw new Error(`expected throw: ${label}`);
}

__weft.open("00000000000000ab", () => true, 3);

const buf = new ArrayBuffer(8);
expectThrows("commit NaN offset", () => __weft.commit(buf, NaN, 2));
expectThrows("commit NaN length", () => __weft.commit(buf, 0, NaN));
expectThrows("commit negative offset", () => __weft.commit(buf, -1, 2));
expectThrows("commit Infinity length", () => __weft.commit(buf, 0, Infinity));
expectThrows("commit fractional offset", () => __weft.commit(buf, 1.5, 2));
expectThrows("commit overflow", () => __weft.commit(buf, 6, 4));
expectThrows("commit huge offset", () => __weft.commit(buf, 1e30, 1));

expectThrows("view NaN byteOffset", () =>
  __weft.call("echo", "x", { buffer: buf, byteOffset: NaN, byteLength: 2 }));
expectThrows("view out of bounds", () =>
  __weft.call("echo", "x", { buffer: buf, byteOffset: 6, byteLength: 4 }));
expectThrows("view negative byteOffset", () =>
  __weft.call("echo", "x", { buffer: buf, byteOffset: -1, byteLength: 1 }));
expectThrows("view non-number byteLength", () =>
  __weft.call("echo", "x", { buffer: buf, byteOffset: 0, byteLength: "2" }));

let timerFired = false;
setTimeout(() => {
  timerFired = true;
}, 0);
clearTimeout(NaN);
clearTimeout(-1);
clearTimeout(1e20);
clearTimeout(1.5);
clearInterval(Infinity);

const RealPromise = globalThis.Promise;
try {
  globalThis.Promise = function FakePromise() {
    return {};
  };
  expectThrows("missing executor call", () => __weft.call("echo", "x", "hi"));
  globalThis.Promise = null;
  expectThrows("non-callable Promise", () => __weft.call("echo", "x", "hi"));
} finally {
  globalThis.Promise = RealPromise;
}

console.log(`bounds-ok:${timerFired}`);
