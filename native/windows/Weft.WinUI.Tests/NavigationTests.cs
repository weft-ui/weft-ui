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
