// Use a mismatching hash too: protocol negotiation must run first.
__weft.open("wrong", () => true, 2, () => {});
