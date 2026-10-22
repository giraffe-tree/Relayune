//! Native menu typography and symbols. All views stay owned by AppKit on its main thread.
use objc2::{rc::Retained, AnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAccessibility, NSAccessibilityGroupRole, NSAutoresizingMaskOptions, NSColor, NSFont,
    NSFontWeightRegular, NSFontWeightSemibold, NSImage, NSImageView, NSMenu, NSTextField, NSView,
};
use objc2_foundation::{NSData, NSPoint, NSRect, NSSize, NSString};

pub(crate) const STATUS_TAG: isize = 1001;
const DOT_TAG: isize = 1002;
const WIDTH: f64 = 224.0;

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

fn symbol(name: &str, size: f64) -> Option<Retained<NSImage>> {
    let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(name),
        None,
    )?;
    image.setSize(NSSize::new(size, size));
    image.setTemplate(true);
    Some(image)
}

fn header(mtm: MainThreadMarker) -> Option<Retained<NSView>> {
    let view = NSView::initWithFrame(NSView::alloc(mtm), rect(0.0, 0.0, WIDTH, 54.0));
    view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
    view.setAccessibilityElement(true);
    view.setAccessibilityRole(Some(unsafe { NSAccessibilityGroupRole }));
    view.setAccessibilityIdentifier(Some(&NSString::from_str("RelayuneMenuHeader")));

    let logo = NSImage::initWithData(
        NSImage::alloc(),
        &NSData::with_bytes(include_bytes!("../icons/trayTemplate.png")),
    )?;
    logo.setTemplate(true);
    let image = NSImageView::initWithFrame(NSImageView::alloc(mtm), rect(16.0, 15.0, 24.0, 24.0));
    image.setImage(Some(&logo));
    image.setContentTintColor(Some(&NSColor::labelColor()));
    image.setAccessibilityElement(false);
    image.setAccessibilityHidden(true);
    view.addSubview(&image);

    let title = NSTextField::labelWithString(&NSString::from_str("Relayune"), mtm);
    title.setFont(Some(&NSFont::systemFontOfSize_weight(13.0, unsafe {
        NSFontWeightSemibold
    })));
    title.setTextColor(Some(&NSColor::labelColor()));
    title.setFrame(rect(52.0, 29.0, WIDTH - 68.0, 17.0));
    title.setAccessibilityElement(false);
    title.setAccessibilityHidden(true);
    view.addSubview(&title);

    let status = NSTextField::labelWithString(&NSString::new(), mtm);
    status.setFont(Some(&NSFont::systemFontOfSize_weight(11.0, unsafe {
        NSFontWeightRegular
    })));
    status.setTextColor(Some(&NSColor::secondaryLabelColor()));
    status.setTag(STATUS_TAG);
    status.setFrame(rect(63.0, 12.0, WIDTH - 79.0, 15.0));
    status.setAccessibilityElement(false);
    status.setAccessibilityHidden(true);
    view.addSubview(&status);

    let dot = NSImageView::initWithFrame(NSImageView::alloc(mtm), rect(53.0, 17.0, 5.0, 5.0));
    dot.setImage(symbol("circle.fill", 5.0).as_deref());
    dot.setTag(DOT_TAG);
    dot.setAccessibilityElement(false);
    dot.setAccessibilityHidden(true);
    view.addSubview(&dot);
    Some(view)
}

/// Layout: identity / primary actions / maintenance / quit. Titles and callbacks remain native.
pub(crate) fn refresh(
    mtm: MainThreadMarker,
    menu: &NSMenu,
    connected_text: &str,
    attention_text: &str,
) -> bool {
    let Some(item) = menu.itemAtIndex(0) else {
        return false;
    };
    let view = match item.view() {
        Some(view) => view,
        None => {
            let Some(view) = header(mtm) else {
                return false;
            };
            item.setView(Some(&view));
            view
        }
    };
    let Some(status) = view
        .viewWithTag(STATUS_TAG)
        .and_then(|view| view.downcast::<NSTextField>().ok())
    else {
        return false;
    };
    let Some(dot) = view
        .viewWithTag(DOT_TAG)
        .and_then(|view| view.downcast::<NSImageView>().ok())
    else {
        return false;
    };
    let text = item.title();
    status.setStringValue(&text);
    // Expand for translated status text, with one baseline and consistent side insets.
    status.sizeToFit();
    let width = WIDTH.max(status.frame().size.width + 79.0);
    view.setFrameSize(NSSize::new(width, 54.0));
    status.setFrame(rect(63.0, 12.0, width - 79.0, 15.0));
    menu.setMinimumWidth(width);
    let color = if text.to_string() == connected_text {
        NSColor::systemGreenColor()
    } else if text.to_string() == attention_text {
        NSColor::systemOrangeColor()
    } else {
        NSColor::secondaryLabelColor()
    };
    dot.setContentTintColor(Some(&color));
    view.setAccessibilityLabel(Some(&NSString::from_str(&format!("Relayune, {text}"))));
    // Native checkmarks and submenu arrows carry meaning; extra action icons
    // would add another gutter and compete with the preference's checked state.
    true
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Indicator {
    On,
    Off,
    Attention,
}

/// Use the native state-image gutter: small colored dots without an extra icon column.
/// Checked semantics and native menu callbacks remain intact for keyboard/VoiceOver users.
pub(crate) fn refresh_power_indicators(menu: &NSMenu, indicators: &[(String, Indicator)]) {
    for (title, state) in indicators {
        let data: &[u8] = match state {
            Indicator::On => include_bytes!("../icons/power-dot-green.png"),
            Indicator::Off => include_bytes!("../icons/power-dot-gray.png"),
            Indicator::Attention => include_bytes!("../icons/power-dot-orange.png"),
        };
        let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(data)) else {
            continue;
        };
        image.setSize(NSSize::new(14.0, 14.0));
        image.setTemplate(false);
        for item in menu.itemArray().iter() {
            if item.title().to_string() == *title {
                unsafe {
                    item.setOnStateImage(Some(&image));
                }
                item.setOffStateImage(Some(&image));
                break;
            }
        }
    }
}
