namespace Weft.WinUI.Tests;

[TestClass]
public sealed class NavigationTests
{
    [TestMethod]
    public void ClassifiesStackTransitions()
    {
        var root = new NavigationState(0, [1], [], 0, 0);
        var pushed = new NavigationState(0, [1], [2], 0, 0);
        var deeper = new NavigationState(0, [1], [2, 3], 0, 0);
        var replaced = new NavigationState(0, [1], [4], 0, 0);
        Assert.AreEqual(NavigationTransition.None, NavigationState.Diff(null, root));
        Assert.AreEqual(NavigationTransition.Push, NavigationState.Diff(root, pushed));
        Assert.AreEqual(NavigationTransition.Pop, NavigationState.Diff(deeper, root));
        Assert.AreEqual(NavigationTransition.None, NavigationState.Diff(pushed, replaced));
    }

    [TestMethod]
    public void TabSwitchClearsStackAndProducesAdoptableSignal()
    {
        var initial = new NavigationState(0, [1, 4], [2, 3], 0, 0);
        var switched = initial.SelectTab(1);
        Assert.AreEqual(4u, switched.Current);
        Assert.AreEqual(0, switched.Stack.Length);
        Assert.AreEqual(NavigationTransition.None, NavigationState.Diff(initial, switched));
        Assert.AreEqual("{\"tab\":1,\"stack\":[],\"modal\":0}", switched.SignalJson());
        CollectionAssert.AreEqual(new uint[] { 1, 4 }, switched.Tabs);
        var lazy = new NavigationState(0, [1, 0], [], 0, 0).SelectTab(1);
        Assert.AreEqual("{\"tab\":1,\"stack\":[],\"modal\":0}", lazy.SignalJson());
    }

    [TestMethod]
    public void ModalTransitionsRetainUnderlyingPageAndDismissWithoutPopping()
    {
        var root = new NavigationState(1, [1, 4], [2], 0, 0);
        foreach (uint style in new uint[] { 0, 1 })
        {
            var modal = root with { Modal = 3, Style = style };
            Assert.AreEqual(3u, modal.Current);
            Assert.AreEqual(2u, modal.Underlying);
            CollectionAssert.AreEquivalent(new uint[] { 1, 2, 3, 4 }, modal.Pages().ToArray());
            Assert.AreEqual(NavigationTransition.None, NavigationState.Diff(root, modal));
            Assert.AreEqual(NavigationTransition.None, NavigationState.Diff(modal, root));
            var dismissed = modal.Back();
            Assert.IsNotNull(dismissed);
            Assert.AreEqual(0u, dismissed.Modal);
            Assert.AreEqual(0u, dismissed.Style);
            Assert.AreEqual("{\"tab\":1,\"stack\":[2],\"modal\":0}", dismissed.SignalJson());
        }
    }

    [TestMethod]
    public void UserBackProducesAdoptableNavigationSignal()
    {
        var state = new NavigationState(0, [1], [2, 3], 0, 0);
        var back = state.Back();
        Assert.IsNotNull(back);
        CollectionAssert.AreEqual(new uint[] { 2 }, back.Stack);
        Assert.AreEqual("{\"tab\":0,\"stack\":[2],\"modal\":0}", back.SignalJson());
        Assert.IsNull(new NavigationState(0, [1], [], 0, 0).Back());
        var modal = new NavigationState(0, [1], [2], 3, 1).Back();
        Assert.IsNotNull(modal);
        Assert.AreEqual(0u, modal.Modal);
        CollectionAssert.AreEqual(new uint[] { 2 }, modal.Stack);
    }
}
