using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.System;

namespace Weft.WinUI;

// Controlled edits dispatch synchronously. When the app refuses an edit, show the
// value slot again. Values applied by set ops are never reported back.

/// <summary>The shared controlled editing path for <c>Input</c> and <c>TextArea</c>.</summary>
public abstract class WeftTextInput : WeftElement
{
    // The normal intrinsic width is about 20 characters, not a fixed layout constraint.
    private const double InputWidth = 200;
    // Layout owns this stable element while Input can swap its native editor.
    private readonly Grid host = new();
    private readonly Func<string, bool> edit;
    private string value = "";
    private int maxLength = int.MaxValue;
    private bool composing, updating, focused, focusPending;
    private protected Control Editor { get; private set; }

    private protected WeftTextInput(Func<string, bool> edit, Action<bool>? focusChanged, Action? submit = null)
    {
        this.edit = edit;
        var box = new TextBox();
        Editor = box;
        Observe(box);
        host.Children.Add(box);
        host.SetValue(WeftLayout.PreferredWidthProperty, InputWidth);
        if (focusChanged is not null)
        {
            var reported = false;
            void Report(object sender, RoutedEventArgs args)
            {
                // Focus events bubble from template children too. Moving within
                // the editor (or replacing it while focused) isn't a focus change.
                var current = HasFocus();
                if (current == reported) return;
                reported = current;
                focusChanged(current);
            }
            host.GotFocus += Report;
            host.LostFocus += Report;
        }
        if (submit is not null)
            host.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler((_, args) =>
            {
                if (args.Key != VirtualKey.Enter || composing) return;
                args.Handled = true;
                submit();
            }), handledEventsToo: true);
    }

    protected sealed override FrameworkElement Control => host;

    protected override void Resize()
    {
        base.Resize();
        ApplyEditorHeight();
    }

    private void ApplyEditorHeight()
    {
        // A fixed Weft height belongs to the whole control. If WinUI's theme
        // minimum is larger, the host would clip the editor's bottom border.
        if (double.IsNaN(host.Height)) return;
        if (Editor is PasswordBox)
            // Its border reads the resource directly rather than binding MinHeight.
            Editor.Resources["TextControlThemeMinHeight"] = 0.0;
        else
            Editor.MinHeight = 0;
    }

    /// <summary>The controlled value slot.</summary>
    public string Value
    {
        set
        {
            this.value = Normalize(value);
            if (!composing && Read() != this.value) Show(this.value);
        }
    }

    public string Placeholder
    {
        set
        {
            if (Editor is TextBox box) box.PlaceholderText = value;
            else ((PasswordBox)Editor).PlaceholderText = value;
        }
    }

    public bool Disabled { set => Editor.IsEnabled = !value; }

    public double MaxLength
    {
        set
        {
            maxLength = value < 0 ? int.MaxValue : (int)Math.Min(value, int.MaxValue);
            ApplyNativeLimit();
        }
    }

    public bool Focused
    {
        set
        {
            if (focused == value) return;
            focused = value;
            if (value && !host.IsLoaded)
            {
                if (!focusPending) host.Loaded += FocusOnLoad;
                focusPending = true;
                return;
            }
            if (value) Editor.Focus(FocusState.Programmatic);
            else if (HasFocus())
                for (var parent = VisualTreeHelper.GetParent(host); parent is not null; parent = VisualTreeHelper.GetParent(parent))
                    if (parent is WeftLinearPanel { IsRoot: true } root)
                    {
                        root.TakeInputFocus();
                        break;
                    }
        }
    }

    private void FocusOnLoad(object sender, RoutedEventArgs args)
    {
        host.Loaded -= FocusOnLoad;
        focusPending = false;
        if (focused) Editor.Focus(FocusState.Programmatic);
    }

    private bool HasFocus()
    {
        if (host.XamlRoot is not { } root) return false;
        for (var target = FocusManager.GetFocusedElement(root) as DependencyObject; target is not null; target = VisualTreeHelper.GetParent(target))
            if (target == host) return true;
        return false;
    }

    private protected void ReplaceEditor(Control editor)
    {
        var previous = Editor;
        var hadFocus = HasFocus();
        Editor = editor;
        composing = false;
        Disabled = !previous.IsEnabled;
        Placeholder = previous is TextBox box ? box.PlaceholderText : ((PasswordBox)previous).PlaceholderText;
        ApplyEditorHeight();
        ApplyNativeLimit();
        if (value.Length != 0) Show(value);
        Observe(editor);
        host.Children.Add(editor);
        if (hadFocus) editor.Focus(FocusState.Programmatic);
        host.Children.Remove(previous);
    }

    private void Observe(Control editor)
    {
        if (editor is PasswordBox password)
        {
            password.PasswordChanged += (sender, _) => { if (sender == Editor) Edited(); };
            return;
        }
        var box = (TextBox)editor;
        box.TextChanging += (sender, args) =>
        {
            if (sender == Editor && args.IsContentChanging) Edited();
        };
        // Keep IME composition local until the text is committed.
        box.TextCompositionStarted += (sender, _) => { if (sender == Editor) composing = true; };
        box.TextCompositionEnded += (sender, _) =>
        {
            if (sender != Editor) return;
            composing = false;
            Edited();
        };
    }

    private void ApplyNativeLimit()
    {
        // Native zero is the unlimited sentinel. LimitEdit also handles an explicit
        // zero, and guards the boundary if a native edit bypasses the property.
        var limit = maxLength == int.MaxValue ? 0 : maxLength;
        if (Editor is TextBox box) box.MaxLength = limit;
        else ((PasswordBox)Editor).MaxLength = limit;
    }

    private string Normalize(string text) => Editor is TextBox { AcceptsReturn: true }
        ? text.Replace("\r\n", "\n").Replace('\r', '\n')
        : text;

    private string Read() => Editor is TextBox box ? Normalize(box.Text) : ((PasswordBox)Editor).Password;

    private void Edited()
    {
        if (composing || updating) return;
        var text = Read();
        var limited = LimitEdit(text, maxLength);
        if (limited != text) Show(limited);
        if (limited != value && !edit(limited)) Show(value);
    }

    internal static string LimitEdit(string text, int limit)
    {
        var length = Math.Min(text.Length, limit);
        // Native text input can hand us an edit that has already been cut at
        // MaxLength. Don't send a lone surrogate over the UTF-8 bridge either way.
        var first = text.AsSpan(0, length).IndexOfAnyInRange('\ud800', '\udfff');
        for (var i = first; i >= 0 && i < length; i++)
        {
            if (!char.IsSurrogate(text[i])) continue;
            if (i + 1 == length || !char.IsSurrogatePair(text[i], text[i + 1]))
            {
                length = i;
                break;
            }
            i++;
        }
        return length == text.Length ? text : text[..length];
    }

    /// <summary>Replaces the text, keeping the caret where the new text allows.</summary>
    private void Show(string text)
    {
        updating = true;
        try
        {
            if (Editor is TextBox box)
            {
                var caret = box.SelectionStart;
                box.Text = text;
                box.SelectionStart = Math.Min(caret, box.Text.Length);
            }
            else ((PasswordBox)Editor).Password = text;
        }
        finally
        {
            updating = false;
        }
    }
}

/// <summary><c>Input</c>: a single-line <see cref="TextBox"/> or secure <see cref="PasswordBox"/>.</summary>
public sealed class WeftInput(Func<string, bool> edit, Action? submit = null, Action<bool>? focusChanged = null)
    : WeftTextInput(edit, focusChanged, submit)
{
    public WeftInputType Type
    {
        set
        {
            if (value == WeftInputType.Password)
            {
                if (Editor is not PasswordBox) ReplaceEditor(new PasswordBox());
                return;
            }
            if (Editor is not TextBox) ReplaceEditor(new TextBox());
            ((TextBox)Editor).InputScope = new InputScope
            {
                Names =
                {
                    new InputScopeName(value switch
                    {
                        WeftInputType.Number => InputScopeNameValue.Number,
                        WeftInputType.Email => InputScopeNameValue.EmailNameOrAddress,
                        WeftInputType.Phone => InputScopeNameValue.TelephoneNumber,
                        _ => InputScopeNameValue.Default,
                    }),
                },
            };
        }
    }
}

/// <summary><c>TextArea</c>: a wrapping <see cref="TextBox"/> with a three-line intrinsic height.</summary>
public sealed class WeftTextArea : WeftTextInput
{
    private const int Rows = 3;
    private const double LineHeightMultiplier = 1.4;

    public WeftTextArea(Func<string, bool> edit, Action<bool>? focusChanged = null) : base(edit, focusChanged)
    {
        var box = (TextBox)Editor;
        box.AcceptsReturn = true;
        box.TextWrapping = TextWrapping.Wrap;
        ScrollViewer.SetVerticalScrollBarVisibility(box, ScrollBarVisibility.Auto);
        box.RegisterPropertyChangedCallback(TextBox.FontSizeProperty, (_, _) => UpdatePreferredHeight(box));
        box.RegisterPropertyChangedCallback(TextBox.PaddingProperty, (_, _) => UpdatePreferredHeight(box));
        UpdatePreferredHeight(box);
    }

    private void UpdatePreferredHeight(TextBox box) => Element.SetValue(WeftLayout.PreferredHeightProperty,
        box.FontSize * LineHeightMultiplier * Rows + box.Padding.Top + box.Padding.Bottom);
}

/// <summary><c>Checkbox</c>: a <see cref="CheckBox"/> without a label.</summary>
public sealed class WeftCheckbox : WeftElement
{
    private readonly CheckBox box = new() { MinWidth = 0 };
    private readonly Func<bool, bool> edit;
    private bool value;

    public WeftCheckbox(Func<bool, bool> edit)
    {
        this.edit = edit;
        box.IsChecked = false;
        box.Checked += (_, _) => Edited(true);
        box.Unchecked += (_, _) => Edited(false);
    }

    protected override FrameworkElement Control => box;

    /// <summary>The controlled value slot.</summary>
    public bool Checked
    {
        set
        {
            this.value = value;
            box.IsChecked = value;
        }
    }

    public bool Disabled
    {
        set => box.IsEnabled = !value;
    }

    private void Edited(bool now)
    {
        if (now == value) return;
        if (!edit(now)) box.IsChecked = value;
    }
}

/// <summary><c>Switch</c>: a <see cref="ToggleSwitch"/> without on/off labels.</summary>
public sealed class WeftSwitch : WeftElement
{
    private readonly ToggleSwitch toggle = new() { OnContent = "", OffContent = "", MinWidth = 0 };
    private bool value;

    public WeftSwitch(Func<bool, bool> edit) => toggle.Toggled += (_, _) =>
    {
        var now = toggle.IsOn;
        if (now != value && !edit(now)) toggle.IsOn = value;
    };

    protected override FrameworkElement Control => toggle;
    public bool Checked { set { this.value = value; toggle.IsOn = value; } }
    public bool Disabled { set => toggle.IsEnabled = !value; }
}

/// <summary><c>Slider</c>: an integer-valued <see cref="Slider"/>.</summary>
public sealed class WeftSlider : WeftElement
{
    private readonly Slider slider = new() { Maximum = 100, StepFrequency = 1, SmallChange = 1, SnapsTo = SliderSnapsTo.StepValues };
    private double value, minimum, maximum = 100, step = 1;
    private bool updating;
    private bool disabled;

    public WeftSlider(Func<double, bool> edit)
    {
        slider.SetValue(WeftLayout.PreferredWidthProperty, 128.0);
        slider.ValueChanged += (_, _) =>
        {
            if (updating) return;
            var lo = ValidRange ? minimum : 0;
            var hi = ValidRange ? maximum : 1;
            var inc = ValidStep;
            var now = RoundValue(slider.Value, lo, hi, inc);
            if (now == VisibleValue || !edit(now)) Show();
        };
    }

    protected override FrameworkElement Control => slider;
    public double Value { set { this.value = value; Show(); } }
    public double Min { set { minimum = value; UpdateRange(); } }
    public double Max { set { maximum = value; UpdateRange(); } }
    public double Step { set { step = value; UpdateRange(); } }
    public bool Disabled { set { disabled = value; SyncEnabled(); } }

    private bool ValidRange => double.IsFinite(minimum) && double.IsFinite(maximum) && minimum < maximum;
    private double ValidStep => double.IsFinite(step) && step >= 1 ? step : 1;
    private double VisibleValue => ValidRange
        ? RoundValue(value, minimum, maximum, ValidStep)
        : 0;

    private void SyncEnabled() => slider.IsEnabled = !disabled && ValidRange;

    // Keep the requested value and bounds even when the native Slider coerces a slot.
    // Slots arrive independently, so changing the range must reapply the current value.
    private void UpdateRange()
    {
        updating = true;
        try
        {
            var lo = ValidRange ? minimum : 0;
            var hi = ValidRange ? maximum : 1;
            var inc = ValidStep;
            if (lo > slider.Maximum) slider.Maximum = hi;
            slider.Minimum = lo;
            slider.Maximum = hi;
            slider.StepFrequency = inc;
            slider.SmallChange = inc;
            SyncEnabled();
            Show();
        }
        finally
        {
            updating = false;
        }
    }

    private void Show()
    {
        var wasUpdating = updating;
        updating = true;
        try
        {
            var visible = VisibleValue;
            if (slider.Value != visible) slider.Value = visible;
        }
        finally
        {
            updating = wasUpdating;
        }
    }

    internal static double RoundValue(double value, double min, double max, double step)
    {
        if (!double.IsFinite(min) || !double.IsFinite(max) || !double.IsFinite(step) || step <= 0 || max < min)
        {
            return double.IsFinite(min) ? min : 0;
        }
        if (!double.IsFinite(value)) return min;
        var index = (Math.Clamp(value, min, max) - min) / step;
        // Step values are anchored at min, with ties rounded toward the larger value.
        return min + Math.Min(Math.Floor(index + 0.5), Math.Floor((max - min) / step)) * step;
    }
}

/// <summary><c>Picker</c>: a <see cref="ComboBox"/> showing string options.</summary>
public sealed class WeftPicker : WeftElement
{
    private readonly ComboBox combo = new();
    private double selected = -1;
    private int count;
    private bool updatingOptions;

    public WeftPicker(Func<double, bool> edit) => combo.SelectionChanged += (_, _) =>
    {
        if (updatingOptions) return;
        var now = combo.SelectedIndex;
        if (now != VisibleIndex && (now < 0 || !edit(now))) Show();
    };

    protected override FrameworkElement Control => combo;
    public double Selected { set { selected = value; Show(); } }
    public string Placeholder { set => combo.PlaceholderText = value; }
    public bool Disabled { set => combo.IsEnabled = !value; }

    public IReadOnlyList<string> Options
    {
        set
        {
            updatingOptions = true;
            count = value.Count;
            combo.ItemsSource = value;
            Show();
            updatingOptions = false;
        }
    }

    private int VisibleIndex => PickerIndex(selected, count);

    internal static int PickerIndex(double selected, int count) =>
        double.IsFinite(selected) && selected >= 0 && selected < count ? (int)selected : -1;

    private void Show()
    {
        var index = VisibleIndex;
        if (combo.SelectedIndex != index) combo.SelectedIndex = index;
    }
}
