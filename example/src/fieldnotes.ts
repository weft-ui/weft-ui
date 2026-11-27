import { navigation, ui } from "@weft-ui/platform";
import { About, Bench, Catalog, Detail, Discover, Feed, Inbox, Login, Me, Publish, SocialSettings } from "./App.weft";
import { appendFeed, createBench, createComments, createFeed, noteForId, refreshFeed } from "./data.ts";

let unread = 3;
function feedEvents(page: Feed | Bench) {
  page.onFeedOpen((_, event) => navigation.push(Detail, { id: event.id }));
  page.onFeedPublish(() => navigation.present(Publish, {}, { style: "fullScreen" }));
  page.onFeedEndReached(() => { page.model.notes = appendFeed(page.model.notes); });
  page.onFeedRefresh(() => {
    if (page.model.refreshing) return;
    page.model.refreshing = true;
    setTimeout(() => {
      page.model.notes = refreshFeed(page.model.notes);
      page.model.refreshing = false;
    }, 600);
  });
}

export const fieldnotesPages = {
  Feed: () => {
    const page = new Feed({ notes: createFeed(), refreshing: false }, {});
    feedEvents(page);
    page.onShow(() => { queueMicrotask(() => { if (unread) navigation.setBadge(Inbox, String(unread)); }); });
    return page;
  },
  Bench: (params: ConstructorParameters<typeof Bench>[1]) => {
    const page = new Bench({ notes: createBench(params.count ?? 10000), refreshing: false }, params);
    feedEvents(page);
    return page;
  },
  Detail: (params: ConstructorParameters<typeof Detail>[1]) => {
    const page = new Detail({ note: noteForId(params.id), comments: createComments() }, params);
    page.onDetailShare(() => { void ui.actionSheet({ title: "分享", options: ["复制链接", "分享给朋友"] }); });
    page.onDetailComment((_, event) => {
      if (!event.text.trim()) return;
      page.model.comments = [...page.model.comments, { id: Date.now(), name: "Mara Chen", date: "Today", message: event.text, avatar: "asset:field_mara" }];
    });
    return page;
  },
  Discover: () => {
    const page = new Discover({ categories: [
      { id: "mountains", title: "Mountains", image: "asset:field_ridge" },
      { id: "coast", title: "Coast", image: "asset:field_coast" },
      { id: "night", title: "After dark", image: "asset:hero" },
      { id: "trails", title: "Trail notes", image: "asset:field_ridge" },
    ] }, {});
    page.onOpenGallery(() => navigation.push(Catalog));
    return page;
  },
  Inbox: () => {
    const page = new Inbox({ sections: [
      { date: "Today", items: [
        { id: "1", message: "Ivo commented on your trail note.", avatar: "asset:avatar" },
        { id: "2", message: "Your note inspired a new walk.", avatar: "asset:field_mara" },
      ] },
      { date: "Yesterday", items: [{ id: "3", message: "Ivo saved your coastal walk.", avatar: "asset:avatar" }] },
    ] }, {});
    page.onShow(() => { unread = 0; queueMicrotask(() => navigation.setBadge(Inbox, null)); });
    return page;
  },
  Me: () => {
    const page = new Me({});
    page.onOpenSocialSettings(() => navigation.push(SocialSettings));
    page.onOpenLogin(() => navigation.present(Login));
    return page;
  },
  SocialSettings: () => {
    const page = new SocialSettings({});
    page.onSelectLanguage(() => { void ui.actionSheet({ title: "Language", options: ["English", "中文"] }); });
    page.onClearCache(async () => {
      if (await ui.confirm({ title: "Clear cache", message: "Clear cached data?", confirmText: "Clear", cancelText: "Cancel" })) ui.toast("Cache cleared", { icon: "success" });
    });
    page.onOpenAbout(() => navigation.present(About));
    return page;
  },
  About: () => { const page = new About({}); page.onDismissSocial(() => navigation.dismiss()); return page; },
  Login: () => {
    const page = new Login({});
    page.onDismissSocial(() => navigation.dismiss());
    page.onSubmitLogin(() => { navigation.dismiss(); ui.toast("Logged in", { icon: "success" }); });
    return page;
  },
  Publish: () => {
    const page = new Publish({ regions: ["North Coast", "High Country", "River Valley"] }, {});
    page.onDismissSocial(() => navigation.dismiss());
    page.onSubmitPublish(() => { navigation.dismiss(); ui.toast("Note published", { icon: "success" }); });
    return page;
  },
};
