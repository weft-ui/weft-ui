Page({
  onReady() {
    getApp().weft.mount(this.selectComponent("#weft"));
  },
  onUnload() {
    getApp().weft.unmount();
  }
});
