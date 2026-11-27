using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;
using FlaUI.Core.Tools;
using FlaUI.Core.WindowsAPI;
using FlaUI.UIA3;

namespace UITests;

[TestClass]
public sealed class Screenshots
{
    [TestMethod]
    public void Pages()
    {
        var pages = Environment.GetEnvironmentVariable("WEFT_PAGES");
        var directory = Environment.GetEnvironmentVariable("WEFT_SHOT_DIR");
        if (pages is null || directory is null)
        {
            Assert.Inconclusive("Run pnpm --filter example shot:windows");
            return;
        }

        foreach (var page in pages.Split(','))
        {
            var parts = page.Split(':');
            var id = parts[0];
            var scheme = parts[1];
            var start = new ProcessStartInfo(UITests.AppPath()) { UseShellExecute = false };
            start.Environment["WEFT_SHOT_APPEARANCE"] = scheme;
            start.Environment["WEFT_SHOT_PAGE"] = id;
            UITests.ClearStorage();
            using var automation = new UIA3Automation();
            using var app = FlaUI.Core.Application.Launch(start);
            try
            {
                var window = app.GetMainWindow(automation, TimeSpan.FromSeconds(10));
                Assert.IsNotNull(window);
                var label = $"page:{id}";
                var button = FindButton(window, label);
                if (button is null)
                {
                    var tree = string.Join("\n", window.FindAllDescendants().Select(element =>
                        $"{element.Properties.ControlType.ValueOrDefault}: {element.Properties.Name.ValueOrDefault}"));
                    Assert.Fail($"No catalog button {label}. Window elements:\n{tree}");
                }
                button.Patterns.ScrollItem.PatternOrDefault?.ScrollIntoView();
                button.AsButton().Invoke();
                var back = FindButton(window, "Back");
                Assert.IsNotNull(back, $"Navigation to {id} did not complete");
                Thread.Sleep(TimeSpan.FromSeconds(1)); // Allow the push animation to finish before capture.

                if (id == "lifecycle") VerifyLifecycle(window);
                var suffix = scheme == "dark" ? "-dark" : "";
                var path = Path.Combine(directory, $"{id}{suffix}.png");
                CaptureWindow(window, path, id == "form" ? capture => VerifyFormInputBorders(window, capture) : null);
                if (id == "appearance") VerifyVisibility(window);
                if (id == "text") VerifyTypography(window);
                if (id == "controls") VerifyControls(window);
                if (id == "inputs") VerifyInputs(window);
                if (id == "tap") VerifyTaps(window);
                if (id == "overlays") VerifyOverlays(window);
                back.AsButton().Invoke();
                Assert.IsNotNull(FindButton(window, label), $"Returning from {id} did not restore the catalog");
                Thread.Sleep(TimeSpan.FromMilliseconds(300)); // Let the native pop animation finish.
            }
            finally
            {
                app.Close();
            }
        }
    }

    internal static AutomationElement? FindButton(Window window, string label) =>
        Retry.WhileNull(() => window.FindAllDescendants(cf => cf.ByControlType(ControlType.Button))
            .FirstOrDefault(candidate => candidate.Properties.Name.ValueOrDefault == label ||
                candidate.FindFirstDescendant(cf => cf.ByName(label)) is not null),
            TimeSpan.FromSeconds(5), ignoreException: true).Result;

    private static void VerifyLifecycle(Window window)
    {
        var handle = window.Properties.NativeWindowHandle.Value;
        ShowWindow(handle, 6); // SW_MINIMIZE
        Thread.Sleep(TimeSpan.FromSeconds(1));
        ShowWindow(handle, 9); // SW_RESTORE
        foreach (var text in new[] { "Background: 1", "Foreground: 1" })
        {
            var result = Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName(text)),
                TimeSpan.FromSeconds(5), ignoreException: true).Result;
            var names = string.Join(", ", window.FindAllDescendants().Select(element => element.Properties.Name.ValueOrDefault));
            Assert.IsNotNull(result, $"Missing {text} after minimize/restore; elements: {names}");
        }
    }

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(nint window, int command);

    private static void VerifyOverlays(Window window)
    {
        void Click(string label)
        {
            var button = FindButton(window, label);
            Assert.IsNotNull(button, $"Missing button {label}");
            button.AsButton().Invoke();
        }
        void Expect(string label)
        {
            var item = Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName(label)),
                TimeSpan.FromSeconds(5), ignoreException: true).Result;
            Assert.IsNotNull(item, $"Missing {label}");
        }
        Click("Alert");
        Expect("This is an alert.");
        Click("OK");
        Expect("Alert dismissed.");
        Click("Confirm");
        Expect("Continue?");
        Keyboard.Type(VirtualKeyShort.ESCAPE);
        Expect("Cancelled.");
        Click("Confirm");
        Click("OK");
        Expect("Confirmed.");
        Click("Action sheet");
        Click("Second");
        Expect("Selected option 2.");
        Click("Action sheet");
        Expect("Choose an option");
        Keyboard.Type(VirtualKeyShort.ESCAPE);
        Expect("Action sheet cancelled.");
        Click("Toast");
        Expect("This is a toast.");
        Expect("Toast shown.");
        Thread.Sleep(TimeSpan.FromSeconds(2));
        Assert.IsNull(window.FindFirstDescendant(cf => cf.ByName("This is a toast.")), "Toast did not disappear");
    }

    private static void VerifyVisibility(Window window)
    {
        const string cardLabel = "This card leaves no gap when hidden.";
        var hide = FindButton(window, "Hide card");
        var card = window.FindFirstDescendant(cf => cf.ByName(cardLabel));
        var end = window.FindFirstDescendant(cf => cf.ByName("End of grid"));
        Assert.IsNotNull(hide);
        Assert.IsNotNull(card);
        Assert.IsNotNull(end);
        var fixedGap = end.BoundingRectangle.Top - card.BoundingRectangle.Bottom;
        var before = end.BoundingRectangle.Top;

        hide.AsButton().Invoke();
        var show = FindButton(window, "Show card");
        Assert.IsNotNull(show);
        var after = Retry.While(() => end.BoundingRectangle.Top, y => y >= before, TimeSpan.FromSeconds(5));
        Assert.IsFalse(after.TimedOut, "The last label must move up when the card collapses");
        Assert.IsNull(window.FindFirstDescendant(cf => cf.ByName(cardLabel)));
        Assert.IsTrue(after.Result - show.BoundingRectangle.Bottom < fixedGap,
            "The collapsed card must not leave its own gap after the button");

        show.AsButton().Invoke();
        Assert.IsNotNull(FindButton(window, "Hide card"));
        Assert.IsNotNull(Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName(cardLabel)),
            TimeSpan.FromSeconds(5)).Result);
    }

    private static void VerifyTypography(Window window)
    {
        var texts = window.FindAllDescendants(cf => cf.ByControlType(ControlType.Text));
        AutomationElement Text(string prefix)
        {
            var matches = texts.Where(element =>
                element.Properties.Name.ValueOrDefault?.StartsWith(prefix, StringComparison.Ordinal) == true).ToArray();
            Assert.AreEqual(1, matches.Length, $"Expected one text block beginning with {prefix}");
            return matches[0];
        }

        Assert.AreEqual("Read closely, pause often, then turn the page.",
            Text("Read closely").Properties.Name.ValueOrDefault, "Spans must read as one text block");

        var oneLine = Text("Italic").BoundingRectangle.Height;
        Assert.IsTrue(oneLine > 0);
        var limited = Text("The wind lifted").BoundingRectangle.Height;
        Assert.AreEqual(2.0 * oneLine, limited, 2.0, "The limited paragraph must occupy two lines");

        var compact = Text("18 px").BoundingRectangle.Height;
        var expanded = Text("28 px").BoundingRectangle.Height;
        Assert.IsTrue(compact > 0);
        Assert.AreEqual(28.0 / 18.0, (double)expanded / compact, 0.08, "Both lines must use the requested height");
    }

    private static void VerifyControls(Window window)
    {
        AutomationElement[] Elements(string className, int count)
        {
            var matches = window.FindAllDescendants(cf => cf.ByClassName(className));
            Assert.AreEqual(count, matches.Length, $"Expected {count} {className} controls");
            return matches;
        }

        var switches = Elements("ToggleSwitch", 4);
        var locked = switches[0].Patterns.Toggle.Pattern;
        var alerts = switches[1].Patterns.Toggle.Pattern;
        var sounds = switches[2].Patterns.Toggle.Pattern;
        var checkboxes = Elements("CheckBox", 2);
        var checkbox = checkboxes[0].AsCheckBox();
        var sliders = Elements("Slider", 2);
        var slider = sliders[0].AsSlider();
        var pickers = Elements("ComboBox", 3);
        var region = pickers[0].AsComboBox();
        var channel = pickers[1].AsComboBox();
        var textAreas = Elements("TextBox", 2);
        var notes = textAreas[0].AsTextBox();
        Assert.IsTrue(notes.BoundingRectangle.Height > region.BoundingRectangle.Height * 1.5,
            "The multiline box should reserve three lines even while empty");
        foreach (var disabled in new[] { switches[3], checkboxes[1], sliders[1], pickers[2], textAreas[1] })
            Assert.IsFalse(disabled.IsEnabled, $"{disabled.Properties.ClassName.Value} should be disabled");

        void Volume(double value)
        {
            Assert.AreEqual(value, slider.Value, "The slider thumb must match the controlled value");
            Assert.IsNotNull(window.FindFirstDescendant(cf => cf.ByName($"音量 · {value}%")),
                "The Weft state must also hold the stepped value");
        }

        void Select(ComboBox picker, string label)
        {
            picker.Expand();
            var item = Retry.WhileNull(() => picker.FindFirstDescendant(cf => cf.ByName(label)
                .And(cf.ByControlType(ControlType.ListItem))), TimeSpan.FromSeconds(3)).Result;
            Assert.IsNotNull(item, $"No picker option {label}");
            item.Patterns.SelectionItem.Pattern.Select();
            picker.Collapse();
        }

        string Notes() => notes.Text.Replace("\r\n", "\n").Replace('\r', '\n');

        Assert.AreEqual(ToggleState.Off, locked.ToggleState.Value);
        Assert.AreEqual(ToggleState.On, alerts.ToggleState.Value);
        Assert.AreEqual(ToggleState.Off, sounds.ToggleState.Value);
        Assert.AreEqual(ToggleState.On, checkbox.ToggleState);
        Assert.AreEqual("本地", region.SelectedItem?.Text);
        Assert.IsNull(channel.SelectedItem, "An out-of-range value must show the placeholder");
        Volume(40);

        alerts.Toggle();
        sounds.Toggle();
        checkbox.Toggle();
        slider.Value = 66;
        Select(region, "远程");
        notes.Text = "first\r\nsecond";
        Assert.AreEqual(ToggleState.Off, alerts.ToggleState.Value);
        Assert.AreEqual(ToggleState.On, sounds.ToggleState.Value);
        Assert.AreEqual(ToggleState.Off, checkbox.ToggleState);
        Volume(65);
        Assert.AreEqual("远程", region.SelectedItem?.Text);
        Assert.AreEqual("first\nsecond", Notes());

        locked.Toggle();
        Assert.AreEqual(ToggleState.On, locked.ToggleState.Value);
        alerts.Toggle();
        sounds.Toggle();
        checkbox.Toggle();
        slider.Value = 40;
        Select(region, "本地");
        Select(channel, "测试版");
        notes.Text = "rejected";
        Assert.AreEqual(ToggleState.Off, alerts.ToggleState.Value);
        Assert.AreEqual(ToggleState.On, sounds.ToggleState.Value);
        Assert.AreEqual(ToggleState.Off, checkbox.ToggleState);
        Volume(65);
        Assert.AreEqual("远程", region.SelectedItem?.Text);
        Assert.IsNull(channel.SelectedItem, "A refused selection must bring back the placeholder");
        Assert.AreEqual("first\nsecond", Notes());

        locked.Toggle();
        Select(channel, "测试版");
        Assert.AreEqual("测试版", channel.SelectedItem?.Text);
    }

    private static void VerifyFormInputBorders(Window window, CaptureImage capture)
    {
        var boxes = window.FindAllDescendants(cf => cf.ByClassName("TextBox").Or(cf.ByClassName("PasswordBox")))
            .OrderBy(box => box.BoundingRectangle.Top).ToArray();
        Assert.AreEqual(6, boxes.Length, "Expected five single-line editors and a text area");
        var bitmap = capture.Bitmap;
        var origin = capture.OriginalBounds.Location;
        foreach (var box in boxes.Take(5))
        {
            var bounds = box.BoundingRectangle;
            var x = bounds.Left + 3 * bounds.Width / 4 - origin.X;
            var bottom = bounds.Bottom - origin.Y;
            var outside = bitmap.GetPixel(x, bottom + 1).R;
            var edge = Enumerable.Range(1, Math.Max(1, bounds.Height / 8))
                .Min(offset => bitmap.GetPixel(x, bottom - offset).R);
            Assert.IsTrue(edge < outside - 10,
                $"{box.Properties.ClassName.Value} at {bounds} must show its bottom border (capture {capture.OriginalBounds})");
        }
    }

    private static void VerifyInputs(Window window)
    {
        var boxes = window.FindAllDescendants(cf => cf.ByClassName("TextBox"));
        Assert.AreEqual(5, boxes.Length, "Expected four single-line text boxes and the notes area");
        var password = window.FindFirstDescendant(cf => cf.ByClassName("PasswordBox"));
        Assert.IsNotNull(password, "Password input must use WinUI's secure control");
        Assert.IsTrue(password.Properties.IsPassword.ValueOrDefault);
        var input = boxes[0].AsTextBox();
        var notes = boxes[^1].AsTextBox();

        void Expect(Func<bool> predicate, string message) => Assert.IsFalse(
            Retry.While(() => !predicate(), pending => pending, TimeSpan.FromSeconds(5)).TimedOut, message);
        void TextIs(TextBox box, string expected, string message)
        {
            var result = Retry.While(() => box.Text, text => text != expected, TimeSpan.FromSeconds(5));
            Assert.AreEqual(expected, result.Result, message);
        }
        bool Label(string text) => window.FindFirstDescendant(cf => cf.ByName(text)) is not null;
        bool Focused() => input.Properties.HasKeyboardFocus.ValueOrDefault;
        void Click(string label)
        {
            var button = FindButton(window, label);
            Assert.IsNotNull(button);
            button.AsButton().Invoke();
        }

        Click("聚焦文本框");
        Expect(() => Focused() && Label("已聚焦"), "A true focus edge must focus the input and report it");
        var beforeSplit = new string('a', 19);
        Paste(beforeSplit + "😀");
        TextIs(input, beforeSplit, "The twentieth unit must not hold half an emoji");
        Expect(() => Label("19/20"), "The binding must receive the truncated edit");
        Keyboard.Type(VirtualKeyShort.RETURN);
        TextIs(input, "", "Enter must submit and clear the controlled value");
        Expect(() => Label("0/20"), "Enter must clear the binding too");
        var fits = new string('a', 18) + "😀";
        Paste(fits + "z");
        TextIs(input, fits, "A full emoji fits in two UTF-16 units");
        Expect(() => Label("20/20"), "The binding must count two units for a full emoji");

        notes.Focus();
        Expect(() => !Focused() && Label("未聚焦"), "User blur must report focus loss without requesting it again");
        var notesLimit = new string('a', 79);
        Paste(notesLimit + "😀");
        TextIs(notes, notesLimit, "TextArea must also enforce its UTF-16 limit");
        Assert.IsFalse(Focused(), "Editing another control must not reapply a previous focus request");
        Assert.IsNotNull(FindButton(window, "放弃焦点"), "A user blur must not write back to the focus slot");
        input.Focus();
        Expect(() => Focused() && Label("已聚焦"), "A user focus change must also report focus gain");
        Click("放弃焦点");
        Expect(() => !Focused() && Label("未聚焦"), "A false focus edge must release keyboard focus");
        Click("聚焦文本框");
        Expect(() => Focused() && Label("已聚焦"), "A subsequent true edge must request focus again");
    }

    private static void VerifyTaps(Window window)
    {
        AutomationElement Button(string label) => window.FindFirstDescendant(cf =>
            cf.ByControlType(ControlType.Button).And(cf.ByName(label)))
            ?? throw new AssertFailedException($"Missing accessible button '{label}'");

        static System.Drawing.Point Center(AutomationElement element)
        {
            var bounds = element.BoundingRectangle;
            return new(bounds.Left + bounds.Width / 2, bounds.Top + bounds.Height / 2);
        }

        void Counts(int rows, int cards, int buttons, int texts)
        {
            foreach (var label in new[] { $"Rows: {rows}", $"Cards: {cards}", $"Buttons: {buttons}", $"Text: {texts}" })
                Assert.IsNotNull(Retry.WhileNull(() => window.FindFirstDescendant(cf => cf.ByName(label)),
                    TimeSpan.FromSeconds(3)).Result, $"Expected '{label}' after tapping one target");
        }

        var row = Button("Open details");
        var card = Button("Image card");
        var nested = Button("Nested actions");
        var preview = Button("Preview");
        var save = nested.FindFirstDescendant(cf => cf.ByClassName("Button").And(cf.ByControlType(ControlType.Button)));
        var image = card.FindFirstDescendant(cf => cf.ByClassName("WeftTap").And(cf.ByControlType(ControlType.Button)));
        Assert.IsNotNull(save, "The native button must remain visible inside the tappable row");
        Assert.IsNotNull(image, "The nested tappable image must have a button role even before it loads");
        Counts(0, 0, 0, 0);

        Mouse.Click(Center(row));
        Counts(1, 0, 0, 0);
        Mouse.Click(Center(card));
        Counts(1, 1, 0, 0);
        Mouse.Click(Center(image));
        Counts(1, 2, 0, 0);
        Mouse.Click(Center(save));
        Counts(1, 2, 1, 0);
        Mouse.Click(Center(preview));
        Counts(1, 2, 1, 1);

        // The card's solid background lets us observe feedback without sampling text or the image.
        var bounds = card.BoundingRectangle;
        var probe = new System.Drawing.Rectangle(bounds.Right - bounds.Width / 8, bounds.Top + bounds.Height / 4, 1, 1);
        int Red(System.Drawing.Rectangle rect)
        {
            var previous = SetThreadDpiAwarenessContext(-4);
            if (previous == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                using var pixel = Capture.Rectangle(rect);
                return pixel.Bitmap.GetPixel(0, 0).R;
            }
            finally
            {
                SetThreadDpiAwarenessContext(previous);
            }
        }
        var rest = Red(probe);
        var outside = probe with { Y = bounds.Bottom + 4 };
        var backing = Red(outside);
        var dimmed = rest * 0.6 + backing * 0.4;
        Mouse.Position = Center(card);
        Mouse.Down();
        try
        {
            Assert.IsFalse(Retry.While(() => Red(probe), red => Math.Abs(red - dimmed) > 2,
                TimeSpan.FromSeconds(3)).TimedOut, "Holding a tap must dim the entire element to 60%");
            Counts(1, 2, 1, 1);
            Mouse.Position = outside.Location;
        }
        finally
        {
            Mouse.Up();
        }
        Assert.IsFalse(Retry.While(() => Red(probe), red => red != rest,
            TimeSpan.FromSeconds(3)).TimedOut, "Releasing outside must restore the original opacity");
        Counts(1, 2, 1, 1);

        preview.Focus();
        Keyboard.Type(VirtualKeyShort.RETURN);
        Counts(1, 2, 1, 2);
        preview.Patterns.Invoke.Pattern.Invoke();
        Counts(1, 2, 1, 3);
    }

    private static void Paste(string text)
    {
        // Enter the entire edit at once, independently of the guest's active IME.
        var command = "Set-Clipboard -Value '" + text.Replace("'", "''") + "'";
        var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add("-NoProfile");
        start.ArgumentList.Add("-EncodedCommand");
        start.ArgumentList.Add(Convert.ToBase64String(Encoding.Unicode.GetBytes(command)));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Cannot set the clipboard");
        Assert.IsTrue(process.WaitForExit(10_000), "Timed out setting the clipboard");
        Assert.AreEqual(0, process.ExitCode, "Cannot set the clipboard");
        Keyboard.TypeSimultaneously(VirtualKeyShort.CONTROL, VirtualKeyShort.KEY_V);
    }

    private static void CaptureWindow(Window window, string path, Action<CaptureImage>? verify)
    {
        // FlaUI crops the desktop by a window's bounds. Use physical pixels for both.
        const int perMonitorAwareV2 = -4;
        var previous = SetThreadDpiAwarenessContext(perMonitorAwareV2);
        if (previous == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            using var capture = Capture.Element(window);
            capture.ToFile(path);
            verify?.Invoke(capture);
        }
        finally
        {
            SetThreadDpiAwarenessContext(previous);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint SetThreadDpiAwarenessContext(nint dpiContext);
}
