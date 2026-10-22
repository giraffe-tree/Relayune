//! The macOS menu is the primary wake preference UI, independent of the WebView.
use serde::Deserialize;
use std::{collections::HashMap, sync::OnceLock};
use tauri::{
    menu::{CheckMenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Runtime, Wry,
};
use tauri_plugin_dialog::DialogExt;

use crate::macos_tray_menu::Indicator;

use crate::{
    keep_awake::{KeepAwake, Mode, Status},
    model::UiLanguage,
    state::AppState,
};

const MODES: [(Mode, &str); 3] = [
    (Mode::Off, "keep_awake_off"),
    (Mode::AcPower, "keep_awake_ac_power"),
    (Mode::Always, "keep_awake_always"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Copy {
    keep_awake_title: String,
    power_enabled: String,
    power_disabled: String,
    power_attention: String,
    keep_awake_waiting: String,
    prevent_lock_menu_title: String,
    prevent_lock_unavailable: String,
    prevent_lock_stopping: String,
    keep_awake_off: String,
    keep_awake_ac: String,
    keep_awake_always: String,
    keep_awake_error: String,
    keep_awake_save_error: String,
}

impl Copy {
    fn for_language(language: UiLanguage) -> &'static Self {
        static MESSAGES: OnceLock<HashMap<String, Copy>> = OnceLock::new();
        let messages = MESSAGES.get_or_init(|| {
            serde_json::from_str(include_str!("../../src/keep-awake-i18n.json"))
                .expect("bundled wake translations must be valid")
        });
        &messages[language.language_code()]
    }

    fn mode(&self, mode: Mode) -> &str {
        match mode {
            Mode::Off => &self.keep_awake_off,
            Mode::AcPower => &self.keep_awake_ac,
            Mode::Always => &self.keep_awake_always,
        }
    }

    fn title(&self, status: &Status) -> String {
        let state = if status.active && !status.error {
            &self.power_enabled
        } else if status.error {
            &self.power_attention
        } else if status.mode == Mode::AcPower {
            &self.keep_awake_waiting
        } else {
            &self.power_disabled
        };
        format!(
            "{} · {} · {}",
            self.keep_awake_title,
            self.mode(status.mode),
            state
        )
    }

    fn lock_title(&self, status: &Status) -> String {
        if status.lock_prevention_stopping {
            self.prevent_lock_stopping.clone()
        } else if status.prevent_lock && status.error && !status.lock_prevention_active {
            self.prevent_lock_unavailable.clone()
        } else {
            self.prevent_lock_menu_title.clone()
        }
    }
}

pub(crate) fn presentation(language: UiLanguage, status: &Status) -> [(String, Indicator); 1] {
    let copy = Copy::for_language(language);
    let wake = if status.error {
        Indicator::Attention
    } else if status.active {
        Indicator::On
    } else if status.mode == Mode::Off {
        Indicator::Off
    } else {
        Indicator::Attention
    };
    [(copy.title(status), wake)]
}

#[derive(Clone)]
pub(crate) struct KeepAwakeMenu {
    pub(crate) submenu: Submenu<Wry>,
    modes: Vec<(Mode, CheckMenuItem<Wry>)>,
    pub(crate) prevent_lock: CheckMenuItem<Wry>,
}

impl KeepAwakeMenu {
    pub(crate) fn new(
        app: &tauri::App<Wry>,
        language: UiLanguage,
        status: &Status,
    ) -> tauri::Result<Self> {
        let copy = Copy::for_language(language);
        let modes = MODES
            .iter()
            .map(|(mode, id)| {
                CheckMenuItem::with_id(
                    app,
                    *id,
                    copy.mode(*mode),
                    status.supported,
                    *mode == status.mode,
                    None::<&str>,
                )
                .map(|item| (*mode, item))
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        let prevent_lock = CheckMenuItem::with_id(
            app,
            "prevent_automatic_lock",
            &copy.prevent_lock_menu_title,
            status.supported,
            status.prevent_lock,
            None::<&str>,
        )?;
        let separator = PredefinedMenuItem::separator(app)?;
        let submenu = Submenu::with_id_and_items(
            app,
            "keep_awake",
            copy.title(status),
            true,
            &[
                &modes[0].1,
                &modes[1].1,
                &modes[2].1,
                &separator,
                &prevent_lock,
            ],
        )?;
        let menu = Self {
            submenu,
            modes,
            prevent_lock,
        };
        menu.refresh(language, status)?;
        Ok(menu)
    }

    pub(crate) fn refresh(&self, language: UiLanguage, status: &Status) -> tauri::Result<()> {
        let copy = Copy::for_language(language);
        // AppKit toggles check items on click. Always restore all checks from
        // the persisted controller, including after a failed save or reselect.
        for (mode, item) in &self.modes {
            item.set_text(copy.mode(*mode))?;
            item.set_checked(*mode == status.mode)?;
            item.set_enabled(status.supported)?;
        }
        self.prevent_lock.set_text(copy.lock_title(status))?;
        self.prevent_lock.set_checked(status.prevent_lock)?;
        self.prevent_lock.set_enabled(status.supported)?;
        self.submenu.set_text(copy.title(status))?;
        if let Some(tray) = self
            .prevent_lock
            .app_handle()
            .tray_by_id("agent-relay-tray")
        {
            let indicators = presentation(language, status);
            tray.with_inner_tray_icon(move |tray_icon| {
                let Some(mtm) = objc2::MainThreadMarker::new() else {
                    return;
                };
                if let Some(menu) = tray_icon.ns_status_item().and_then(|s| s.menu(mtm)) {
                    crate::macos_tray_menu::refresh_power_indicators(&menu, &indicators);
                }
            })?;
        }
        Ok(())
    }
}

pub(crate) fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) -> bool {
    let copy = Copy::for_language(app.state::<AppState>().ui_language());
    let mode = MODES.iter().find(|(_, event_id)| *event_id == id);
    if id == "prevent_automatic_lock" || mode.is_some() {
        let result = if id == "prevent_automatic_lock" {
            app.state::<KeepAwake>().toggle_prevent_lock()
        } else {
            app.state::<KeepAwake>().set_mode(mode.unwrap().0)
        };
        // Release the controller before entering the tray publication gate.
        let refresh = crate::refresh_keep_awake_menu(app);
        use tauri::Emitter;
        let _ = app.emit("keep-awake-changed", ());
        let error = match result {
            Err(_) => Some(&copy.keep_awake_save_error),
            Ok(status) if status.error || refresh.is_err() => Some(&copy.keep_awake_error),
            _ => None,
        };
        if let Some(error) = error {
            app.dialog()
                .message(error)
                .title(&copy.keep_awake_title)
                .show(|_| {});
        }
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_menu_has_copy_for_every_supported_native_language() {
        for code in [
            "zh-CN", "en", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur",
        ] {
            let copy = Copy::for_language(UiLanguage::from_language_code(code).unwrap());
            for text in [
                &copy.keep_awake_title,
                &copy.power_enabled,
                &copy.power_disabled,
                &copy.prevent_lock_menu_title,
                &copy.prevent_lock_unavailable,
                &copy.prevent_lock_stopping,
                &copy.keep_awake_off,
                &copy.keep_awake_ac,
                &copy.keep_awake_always,
            ] {
                assert!(!text.is_empty());
            }
        }
        assert_eq!(
            MODES.iter().map(|(_, id)| *id).collect::<Vec<_>>(),
            ["keep_awake_off", "keep_awake_ac_power", "keep_awake_always"]
        );
    }
    #[test]
    fn indicators_and_optional_lock_copy_follow_effective_wake_state() {
        let mut status = Status {
            mode: Mode::Always,
            prevent_lock: true,
            lock_prevention_active: true,
            lock_prevention_stopping: false,
            supported: true,
            active: true,
            error: false,
        };
        let language = UiLanguage::from_language_code("zh-CN").unwrap();
        let copy = Copy::for_language(language);
        assert_eq!(copy.lock_title(&status), "保持唤醒时，不自动锁屏");
        assert_eq!(
            presentation(language, &status)[0],
            ("保持唤醒 · 始终 · 已开启".into(), Indicator::On)
        );
        status.active = false;
        status.lock_prevention_active = false;
        status.mode = Mode::Off;
        assert_eq!(
            presentation(language, &status)[0],
            ("保持唤醒 · 关闭 · 未开启".into(), Indicator::Off)
        );
        assert_eq!(copy.lock_title(&status), "保持唤醒时，不自动锁屏");
        status.mode = Mode::AcPower;
        assert_eq!(presentation(language, &status)[0].1, Indicator::Attention);
        assert_eq!(copy.lock_title(&status), "保持唤醒时，不自动锁屏");
        status.error = true;
        assert_eq!(copy.lock_title(&status), copy.prevent_lock_unavailable);
        status.lock_prevention_stopping = true;
        assert_eq!(copy.lock_title(&status), copy.prevent_lock_stopping);
    }
}
