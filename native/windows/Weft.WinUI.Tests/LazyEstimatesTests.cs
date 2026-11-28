using Weft.WinUI;

namespace Weft.WinUI.Tests;

[TestClass]
public sealed class LazyEstimatesTests
{
    [TestMethod]
    public void EstimatesAverageHeightsPerTemplate()
    {
        var estimates = new LazyEstimates();
        Assert.AreEqual(44d, estimates.Estimate(1));
        estimates.Record(1, 40);
        estimates.Record(1, 60);
        Assert.AreEqual(50d, estimates.Estimate(1));
        Assert.AreEqual(44d, estimates.Estimate(2));
    }

    [TestMethod]
    public void IgnoresNonPositiveHeights()
    {
        var estimates = new LazyEstimates();
        estimates.Record(1, 0);
        estimates.Record(1, -10);
        Assert.AreEqual(44d, estimates.Estimate(1));
        estimates.Record(1, 60);
        estimates.Record(1, 0);
        estimates.Record(1, -10);
        Assert.AreEqual(60d, estimates.Estimate(1));
    }

    [TestMethod]
    public void RangeRequiresItemsAndNonNegativeIndices()
    {
        Assert.IsNull(LazyEstimates.Range(0, new[] { 1 }));
        Assert.IsNull(LazyEstimates.Range(100, Array.Empty<int>()));
        Assert.IsNull(LazyEstimates.Range(100, new[] { -1, -2 }));
    }

    [TestMethod]
    public void RangeExpandsRealizedIndicesRegardlessOfOrder()
    {
        var window = LazyItems.Window(100, 45, 59);
        Assert.AreEqual((30u, 75u), window);
        Assert.AreEqual(window, LazyEstimates.Range(100, new[] { 45, 50, 59 }));
        Assert.AreEqual(window, LazyEstimates.Range(100, new[] { 59, -1, 45, 50 }));
    }
}
