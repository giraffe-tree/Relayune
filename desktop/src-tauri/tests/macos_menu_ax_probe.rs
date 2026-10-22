#[cfg(target_os = "macos")]
fn main() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSAccessibility, NSApplication, NSMenu, NSMenuItem, NSSquareStatusItemLength, NSStatusBar,
    };
    use objc2_foundation::NSString;

    let main_thread = MainThreadMarker::new().expect("AX probe must run on the macOS main thread");
    let application = NSApplication::sharedApplication(main_thread);
    if std::env::args().any(|arg| arg == "--menu-preview")
        || std::env::current_exe()
            .is_ok_and(|path| path.to_string_lossy().contains("Relayune Menu Preview.app"))
    {
        preview_menu(main_thread, &application);
        return;
    }
    let _prelaunch_policy = application.activationPolicy();
    let status_bar = NSStatusBar::systemStatusBar();
    let status_item = status_bar.statusItemWithLength(NSSquareStatusItemLength);
    assert!(status_item.isVisible());
    let button = status_item
        .button(main_thread)
        .expect("AppKit did not create an NSStatusBarButton");
    let identifier = "RelayuneMenuBarItem";
    let menu = NSMenu::new(main_thread);
    menu.setAutoenablesItems(false);
    let status = NSMenuItem::new(main_thread);
    let window_action = NSMenuItem::new(main_thread);
    let web_action = NSMenuItem::new(main_thread);
    let update_action = NSMenuItem::new(main_thread);
    let diagnostics = NSMenuItem::new(main_thread);
    let quit = NSMenuItem::new(main_thread);
    status.setEnabled(false);
    for item in [
        &status,
        &window_action,
        &web_action,
        &update_action,
        &diagnostics,
        &quit,
    ] {
        menu.addItem(item);
    }
    status_item.setMenu(Some(&menu));
    assert_eq!(menu.numberOfItems(), 6);

    for (tooltip, label, help) in [
        (
            "Relayune · Not connected",
            "Relayune, Not connected",
            "Open the Relayune menu",
        ),
        (
            "Relayune · Not connected · Update available",
            "Relayune, Not connected, Update available",
            "Open the Relayune menu",
        ),
        (
            "Relayune · Needs attention",
            "Relayune, Needs attention",
            "Open the Relayune menu",
        ),
        (
            "Relayune · 需要处理",
            "Relayune，需要处理",
            "打开 Relayune 菜单",
        ),
        (
            "Relayune · 已连接",
            "Relayune，已连接",
            "打开 Relayune 菜单",
        ),
        (
            "Relayune · 已连接 · 有更新",
            "Relayune，已连接，有更新",
            "打开 Relayune 菜单",
        ),
        (
            "Relayune · غير متصل · يتوفر تحديث",
            "Relayune، غير متصل، يتوفر تحديث",
            "فتح قائمة Relayune",
        ),
    ] {
        button.setToolTip(Some(&NSString::from_str(tooltip)));
        button.setAccessibilityLabel(Some(&NSString::from_str(label)));
        button.setAccessibilityHelp(Some(&NSString::from_str(help)));
        button.setAccessibilityIdentifier(Some(&NSString::from_str(identifier)));

        assert_eq!(
            button.toolTip().map(|value| value.to_string()),
            Some(tooltip.into())
        );
        assert_eq!(
            button.accessibilityLabel().map(|value| value.to_string()),
            Some(label.into())
        );
        assert_eq!(
            button.accessibilityHelp().map(|value| value.to_string()),
            Some(help.into())
        );
        assert_eq!(
            button
                .accessibilityIdentifier()
                .map(|value| value.to_string()),
            Some(identifier.into())
        );
    }

    for (
        status_text,
        window_text,
        web_text,
        update_text,
        diagnostics_text,
        quit_text,
        web_enabled,
    ) in [
        (
            "Status: Not connected",
            "Connect This Computer…",
            "Open Web Workspace",
            "Check for Updates…",
            "Help & Diagnostics…",
            "Quit Relayune",
            false,
        ),
        (
            "Status: Not connected",
            "Connect This Computer…",
            "Open Web Workspace",
            "Install Update…",
            "Help & Diagnostics…",
            "Quit Relayune",
            false,
        ),
        (
            "Status: Needs attention",
            "Show Relayune",
            "Open Web Workspace",
            "Check for Updates…",
            "Help & Diagnostics…",
            "Quit Relayune",
            false,
        ),
        (
            "状态：需要处理",
            "显示 Relayune",
            "打开 Web 工作台",
            "检查更新…",
            "帮助与诊断…",
            "退出 Relayune",
            false,
        ),
        (
            "Status: Needs attention",
            "Show Relayune",
            "Open Web Workspace",
            "Check for Updates…",
            "Help & Diagnostics…",
            "Quit Relayune",
            true,
        ),
        (
            "状态：已连接",
            "显示 Relayune",
            "打开 Web 工作台",
            "检查更新…",
            "帮助与诊断…",
            "退出 Relayune",
            true,
        ),
        (
            "الحالة: متصل",
            "إظهار Relayune",
            "فتح مساحة عمل Web",
            "تثبيت التحديث…",
            "المساعدة والتشخيص…",
            "إنهاء Relayune",
            true,
        ),
        (
            "状态：已连接",
            "显示 Relayune",
            "打开 Web 工作台",
            "安装更新…",
            "帮助与诊断…",
            "退出 Relayune",
            true,
        ),
    ] {
        status.setTitle(&NSString::from_str(status_text));
        window_action.setTitle(&NSString::from_str(window_text));
        web_action.setTitle(&NSString::from_str(web_text));
        web_action.setEnabled(web_enabled);
        update_action.setTitle(&NSString::from_str(update_text));
        update_action.setEnabled(true);
        diagnostics.setTitle(&NSString::from_str(diagnostics_text));
        quit.setTitle(&NSString::from_str(quit_text));

        assert_eq!(status.title().to_string(), status_text);
        assert!(!status.isEnabled());
        assert_eq!(window_action.title().to_string(), window_text);
        assert!(window_action.isEnabled());
        assert_eq!(web_action.title().to_string(), web_text);
        assert_eq!(web_action.isEnabled(), web_enabled);
        assert_eq!(update_action.title().to_string(), update_text);
        assert!(update_action.isEnabled());
        assert_eq!(
            update_action
                .accessibilityLabel()
                .map(|value| value.to_string()),
            Some(update_text.into())
        );
        assert_eq!(diagnostics.title().to_string(), diagnostics_text);
        assert!(diagnostics.isEnabled());
        assert_eq!(quit.title().to_string(), quit_text);
        assert!(quit.isEnabled());
    }

    // Production reads this concrete AppKit property both at startup admission
    // and immediately before hiding the last window. Prove that the getter
    // distinguishes a built status item that is not an actual recovery surface.
    status_item.setVisible(false);
    assert!(!status_item.isVisible());
    status_item.setVisible(true);
    assert!(status_item.isVisible());

    status_item.setMenu(None);
    status_bar.removeStatusItem(&status_item);
    verify_menu_design(main_thread);
    println!(
        "macOS status-item AX and menu-state round-trip passed (unpaired + recovery + attention + paired + update action)"
    );
}

/// Interactive AppKit preview using the production decorator, independent of the signed app.
#[cfg(target_os = "macos")]
fn preview_menu(mtm: objc2::MainThreadMarker, application: &objc2_app_kit::NSApplication) {
    use objc2::MainThreadOnly;
    use objc2_app_kit::{
        NSApplicationActivationPolicy, NSBackingStoreType, NSMenu, NSMenuItem, NSTextField,
        NSWindow, NSWindowStyleMask,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

    let menu = NSMenu::new(mtm);
    menu.setAutoenablesItems(false);
    for (index, title) in [
        "已连接",
        "",
        "显示 Relayune",
        "",
        "保持唤醒 · 始终 · 已开启",
        "",
        "检查更新…",
        "退出 Relayune",
    ]
    .iter()
    .enumerate()
    {
        let item = if [1, 3, 5].contains(&index) {
            NSMenuItem::separatorItem(mtm)
        } else {
            NSMenuItem::new(mtm)
        };
        item.setTitle(&NSString::from_str(title));
        item.setEnabled(index != 0);
        if index == 4 {
            let submenu = NSMenu::new(mtm);
            submenu.setAutoenablesItems(false);
            for (index, title) in ["关闭", "仅插电", "始终"].iter().enumerate() {
                let choice = NSMenuItem::new(mtm);
                choice.setTitle(&NSString::from_str(title));
                choice.setEnabled(true);
                choice.setState(if index == 2 { 1 } else { 0 });
                submenu.addItem(&choice);
            }
            submenu.addItem(&NSMenuItem::separatorItem(mtm));
            let lock = NSMenuItem::new(mtm);
            lock.setTitle(&NSString::from_str("保持唤醒时，不自动锁屏"));
            lock.setEnabled(true);
            lock.setState(1);
            submenu.addItem(&lock);
            item.setSubmenu(Some(&submenu));
        }
        if index == 7 {
            item.setKeyEquivalent(&NSString::from_str("q"));
        }
        menu.addItem(&item);
    }
    assert!(macos_tray_menu::refresh(mtm, &menu, "已连接", "需要处理"));
    macos_tray_menu::refresh_power_indicators(
        &menu,
        &[(
            "保持唤醒 · 始终 · 已开启".into(),
            macos_tray_menu::Indicator::On,
        )],
    );
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(480.0, 360.0)),
            NSWindowStyleMask::Titled | NSWindowStyleMask::Closable,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    window.setTitle(&NSString::from_str("Relayune 菜单预览"));
    let view = window.contentView().unwrap();
    // The menu and its inert preview items stay alive through application.run().
    unsafe {
        view.setMenu(Some(&menu));
    }
    let hint = NSTextField::labelWithString(&NSString::from_str("右键查看原生菜单"), mtm);
    hint.setFrame(NSRect::new(
        NSPoint::new(160.0, 300.0),
        NSSize::new(200.0, 20.0),
    ));
    view.addSubview(&hint);
    application.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    window.center();
    window.makeKeyAndOrderFront(None);
    #[allow(deprecated)]
    application.activateIgnoringOtherApps(true);
    application.run();
}

#[cfg(target_os = "macos")]
fn verify_menu_design(mtm: objc2::MainThreadMarker) {
    use objc2_app_kit::{NSAccessibility, NSImageView, NSMenu, NSMenuItem, NSTextField};
    use objc2_foundation::NSString;

    let menu = NSMenu::new(mtm);
    menu.setAutoenablesItems(false);
    for index in 0..9 {
        let item = if [1, 3, 6].contains(&index) {
            NSMenuItem::separatorItem(mtm)
        } else {
            NSMenuItem::new(mtm)
        };
        item.setEnabled(index != 0);
        menu.addItem(&item);
    }
    let item = menu.itemAtIndex(0).unwrap();
    for (text, connected, attention) in [
        ("已连接", "已连接", "需要处理"),
        ("正在连接", "已连接", "需要处理"),
        ("需要处理", "已连接", "需要处理"),
        ("Connected", "Connected", "Needs attention"),
        ("بانتظار الاتصال", "متصل", "يحتاج إلى معالجة"),
        (
            "Reconnecting to this computer",
            "Connected",
            "Needs attention",
        ),
    ] {
        item.setTitle(&NSString::from_str(text));
        assert!(macos_tray_menu::refresh(mtm, &menu, connected, attention));
        let header = item.view().unwrap();
        assert_eq!(header.frame().size.height, 54.0);
        assert!(header.frame().size.width >= 224.0);
        assert_eq!(
            header.accessibilityLabel().unwrap().to_string(),
            format!("Relayune, {text}")
        );
        let status = header
            .viewWithTag(macos_tray_menu::STATUS_TAG)
            .unwrap()
            .downcast::<NSTextField>()
            .unwrap();
        assert_eq!(status.stringValue().to_string(), text);
        assert_eq!(status.font().unwrap().pointSize(), 11.0);
        assert!(
            status.frame().origin.x + status.frame().size.width <= header.frame().size.width - 16.0
        );
        assert!(header
            .subviews()
            .iter()
            .any(|view| view.downcast_ref::<NSImageView>().is_some()));
        let title = header
            .subviews()
            .iter()
            .filter_map(|view| view.downcast::<NSTextField>().ok())
            .find(|label| label.stringValue().to_string() == "Relayune")
            .unwrap()
            .frame();
        assert_eq!(title.origin.x, 52.0);
        assert_eq!(status.frame().origin.x, 63.0);
        assert!(status.frame().origin.y + status.frame().size.height <= title.origin.y);
        let images = header
            .subviews()
            .iter()
            .filter_map(|view| view.downcast::<NSImageView>().ok())
            .collect::<Vec<_>>();
        assert_eq!(images.len(), 2, "brand logo and live status dot");
        let logo = images
            .iter()
            .find(|image| image.frame().size.width == 24.0)
            .unwrap();
        assert!(logo.frame().origin.x + logo.frame().size.width < title.origin.x);
        assert!(logo.image().unwrap().isTemplate());
    }
    assert!(
        !item.isEnabled(),
        "the identity header must not act as a menu command"
    );
    for index in [2, 4, 5, 7, 8] {
        let item = menu.itemAtIndex(index).unwrap();
        assert!(item.isEnabled());
        assert!(item.image().is_none());
    }
    println!(
        "macOS menu design passed (stacked brand header, translated status sizing, AX and native action gutter)"
    );
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("macOS NSStatusBarButton accessibility probe skipped on this platform");
}
#[cfg(target_os = "macos")]
#[path = "../src/macos_tray_menu.rs"]
mod macos_tray_menu;
