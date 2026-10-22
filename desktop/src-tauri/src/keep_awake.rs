//! Local desktop preference. Does not restart Relay, change pmset, or change lock policy.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Off,
    AcPower,
    Always,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
struct Preferences {
    mode: Mode,
    #[serde(default)]
    prevent_lock: bool,
}

impl From<Mode> for Preferences {
    fn from(mode: Mode) -> Self {
        Self {
            mode,
            prevent_lock: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Status {
    pub(crate) mode: Mode,
    pub(crate) prevent_lock: bool,
    /// Confirmed -di power assertions, not an observation of session lock state.
    pub(crate) lock_prevention_active: bool,
    pub(crate) lock_prevention_stopping: bool,
    pub(crate) supported: bool,
    pub(crate) active: bool,
    pub(crate) error: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AssertionKind {
    System,
    Display,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AssertionState {
    Active,
    Inactive,
    Missing,
}
#[derive(Clone, Copy, Debug)]
struct Hold {
    id: u32,
    confirmed: bool,
}

trait PowerBackend {
    fn supported(&self) -> bool;
    fn on_ac_power(&self) -> Result<bool, ()>;
    fn acquire(&mut self) -> Result<u32, ()>;
    fn acquire_display(&mut self) -> Result<u32, ()>;
    fn inspect(&mut self, id: u32, kind: AssertionKind) -> Result<AssertionState, ()>;
    fn release(&mut self, id: u32) -> Result<(), ()>;
}

struct Controller<B: PowerBackend> {
    backend: B,
    preference: Preferences,
    assertion: Option<Hold>,
    display_assertion: Option<Hold>,
    display_requested: bool,
    load_error: bool,
    runtime_error: bool,
}

impl<B: PowerBackend> Controller<B> {
    fn new(backend: B, saved: Result<Preferences, ()>) -> Self {
        Self {
            backend,
            preference: saved.unwrap_or_default(),
            assertion: None,
            display_assertion: None,
            display_requested: false,
            load_error: saved.is_err(),
            runtime_error: false,
        }
    }

    fn status(&self) -> Status {
        Status {
            mode: self.preference.mode,
            prevent_lock: self.preference.prevent_lock,
            lock_prevention_active: self.display_assertion.is_some_and(|h| h.confirmed)
                && self.assertion.is_some_and(|h| h.confirmed),
            lock_prevention_stopping: !self.display_requested && self.display_assertion.is_some(),
            supported: self.backend.supported(),
            active: self.assertion.is_some_and(|h| h.confirmed),
            error: self.load_error || self.runtime_error,
        }
    }

    fn reconcile(&mut self) {
        let supported = self.backend.supported();
        let desired = match self.preference.mode {
            Mode::Off => Ok(false),
            Mode::Always => Ok(supported),
            Mode::AcPower if supported => self.backend.on_ac_power(),
            Mode::AcPower => Ok(false),
        };
        self.display_requested = self.preference.prevent_lock && desired == Ok(true);
        let display_result = maintain_hold(
            &mut self.backend,
            &mut self.display_assertion,
            self.display_requested,
            AssertionKind::Display,
        );
        // Unknown power source must not leave an AC-only hold active on battery.
        let result = maintain_hold(
            &mut self.backend,
            &mut self.assertion,
            desired == Ok(true),
            AssertionKind::System,
        );
        self.runtime_error = desired.is_err() || result.is_err() || display_result.is_err();
    }

    fn release(&mut self) -> Result<(), ()> {
        maintain_hold(
            &mut self.backend,
            &mut self.assertion,
            false,
            AssertionKind::System,
        )
    }

    fn release_display(&mut self) -> Result<(), ()> {
        maintain_hold(
            &mut self.backend,
            &mut self.display_assertion,
            false,
            AssertionKind::Display,
        )
    }

    fn set_preference(
        &mut self,
        preference: Preferences,
        save: impl FnOnce(Preferences) -> Result<(), ()>,
    ) -> Result<Status, ()> {
        if !self.backend.supported() {
            return Err(());
        }
        // Commit the preference before applying it. A failed write leaves the old hold intact.
        save(preference)?;
        self.preference = preference;
        self.load_error = false;
        self.reconcile();
        Ok(self.status())
    }
}

fn maintain_hold<B: PowerBackend>(
    backend: &mut B,
    slot: &mut Option<Hold>,
    desired: bool,
    kind: AssertionKind,
) -> Result<(), ()> {
    if !desired {
        if let Some(hold) = *slot {
            backend.release(hold.id)?;
            *slot = None;
        }
        return Ok(());
    }
    if let Some(hold) = slot {
        match backend.inspect(hold.id, kind) {
            Ok(AssertionState::Active) => {
                hold.confirmed = true;
                return Ok(());
            }
            Ok(AssertionState::Missing) => *slot = None,
            Ok(AssertionState::Inactive) => {
                hold.confirmed = false;
                backend.release(hold.id)?;
                *slot = None;
            }
            Err(()) => {
                hold.confirmed = false;
                return Err(());
            }
        }
    }
    let id = match kind {
        AssertionKind::System => backend.acquire()?,
        AssertionKind::Display => backend.acquire_display()?,
    };
    *slot = Some(Hold {
        id,
        confirmed: false,
    });
    match backend.inspect(id, kind) {
        Ok(AssertionState::Active) => {
            slot.as_mut().unwrap().confirmed = true;
            Ok(())
        }
        Ok(AssertionState::Missing) => {
            *slot = None;
            Err(())
        }
        Ok(AssertionState::Inactive) | Err(()) => Err(()),
    }
}

impl<B: PowerBackend> Drop for Controller<B> {
    fn drop(&mut self) {
        let _ = self.release();
        let _ = self.release_display();
    }
}

fn load(path: &Path) -> Result<Preferences, ()> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Saved {
        Current(Preferences),
        Legacy(Mode),
    }
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(|saved| match saved {
                Saved::Current(preference) => preference,
                Saved::Legacy(mode) => mode.into(),
            })
            .map_err(|_| ()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(_) => Err(()),
    }
}

fn save(path: &Path, preference: Preferences) -> Result<(), ()> {
    let parent = path.parent().ok_or(())?;
    fs::create_dir_all(parent).map_err(|_| ())?;
    let temporary = parent.join(format!(".keep-awake-{:016x}.tmp", rand::random::<u64>()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| ())?;
        file.write_all(&serde_json::to_vec(&preference).map_err(|_| ())?)
            .map_err(|_| ())?;
        file.sync_all().map_err(|_| ())?;
        fs::rename(&temporary, path).map_err(|_| ())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[derive(Clone)]
pub struct KeepAwake {
    controller: Arc<Mutex<Controller<NativePower>>>,
    path: Option<PathBuf>,
    stopped: Arc<AtomicBool>,
}

impl KeepAwake {
    pub fn start(app: &AppHandle) -> Self {
        let path = crate::config::config_path(app)
            .ok()
            .map(|p| p.with_file_name("keep-awake.json"));
        let saved = path.as_deref().ok_or(()).and_then(load);
        let mut controller = Controller::new(NativePower, saved);
        controller.reconcile();
        let service = Self {
            controller: Arc::new(Mutex::new(controller)),
            path,
            stopped: Arc::new(AtomicBool::new(false)),
        };
        if cfg!(target_os = "macos") {
            let worker = service.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                // Native timer continues when the WebView is hidden/throttled.
                // Also retries transient power-source/assertion failures after wake.
                while !worker.stopped.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_secs(2));
                    let Ok(mut controller) = worker.controller.lock() else {
                        break;
                    };
                    if worker.stopped.load(Ordering::Acquire) {
                        break;
                    }
                    let before = controller.status();
                    controller.reconcile();
                    let after = controller.status();
                    drop(controller);
                    if before != after {
                        publish_status(&app);
                    }
                }
            });
        }
        service
    }

    pub(crate) fn status(&self) -> Result<Status, String> {
        Ok(self.controller.lock().map_err(|_| error())?.status())
    }

    pub(crate) fn set_mode(&self, mode: Mode) -> Result<Status, String> {
        let mut controller = self.controller.lock().map_err(|_| error())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err(error());
        }
        let path = self.path.as_deref().ok_or_else(error)?;
        let preference = Preferences {
            mode,
            ..controller.preference
        };
        controller
            .set_preference(preference, |p| save(path, p))
            .map_err(|_| error())
    }

    pub(crate) fn toggle_prevent_lock(&self) -> Result<Status, String> {
        let mut controller = self.controller.lock().map_err(|_| error())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err(error());
        }
        let path = self.path.as_deref().ok_or_else(error)?;
        let preference = Preferences {
            prevent_lock: !controller.preference.prevent_lock,
            ..controller.preference
        };
        controller
            .set_preference(preference, |p| save(path, p))
            .map_err(|_| error())
    }

    pub(crate) fn set_prevent_lock(&self, enabled: bool) -> Result<Status, String> {
        let mut controller = self.controller.lock().map_err(|_| error())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err(error());
        }
        let path = self.path.as_deref().ok_or_else(error)?;
        let preference = Preferences {
            prevent_lock: enabled,
            ..controller.preference
        };
        controller
            .set_preference(preference, |p| save(path, p))
            .map_err(|_| error())
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Ok(mut controller) = self.controller.lock() {
            let _ = controller.release();
            let _ = controller.release_display();
        }
    }
}

fn error() -> String {
    crate::model::user_error("keep_awake_failed")
}

fn publish_status(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = crate::refresh_keep_awake_menu(app);
    use tauri::Emitter;
    let _ = app.emit("keep-awake-changed", ());
}

struct NativePower;

#[cfg(not(target_os = "macos"))]
impl PowerBackend for NativePower {
    fn supported(&self) -> bool {
        false
    }
    fn on_ac_power(&self) -> Result<bool, ()> {
        Err(())
    }
    fn acquire(&mut self) -> Result<u32, ()> {
        Err(())
    }
    fn acquire_display(&mut self) -> Result<u32, ()> {
        Err(())
    }
    fn inspect(&mut self, _id: u32, _kind: AssertionKind) -> Result<AssertionState, ()> {
        Err(())
    }
    fn release(&mut self, _id: u32) -> Result<(), ()> {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{AssertionKind, AssertionState, NativePower, PowerBackend};
    use std::ffi::{c_char, c_void};
    type CFRef = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(allocator: CFRef, text: *const c_char, encoding: u32)
            -> CFRef;
        fn CFRelease(object: CFRef);
        fn CFEqual(first: CFRef, second: CFRef) -> u8;
        fn CFGetTypeID(value: CFRef) -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFDictionaryGetValue(dictionary: CFRef, key: CFRef) -> CFRef;
        fn CFNumberGetValue(number: CFRef, kind: isize, value: *mut i32) -> u8;
        fn CFNumberCreate(allocator: CFRef, kind: isize, value: *const i32) -> CFRef;
    }
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithDescription(
            kind: CFRef,
            name: CFRef,
            details: CFRef,
            reason: CFRef,
            localization: CFRef,
            timeout: f64,
            action: CFRef,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionCopyProperties(id: u32) -> CFRef;
        fn IOPMAssertionSetProperty(id: u32, property: CFRef, value: CFRef) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
        fn IOPSCopyPowerSourcesInfo() -> CFRef;
        fn IOPSGetProvidingPowerSourceType(info: CFRef) -> CFRef;
    }

    struct OwnedCF(CFRef);
    impl OwnedCF {
        fn string(text: &'static std::ffi::CStr) -> Result<Self, ()> {
            // Null allocator means the default allocator; 0x08000100 is UTF-8.
            let value =
                unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), 0x08000100) };
            if value.is_null() {
                Err(())
            } else {
                Ok(Self(value))
            }
        }
    }
    impl Drop for OwnedCF {
        fn drop(&mut self) {
            unsafe {
                CFRelease(self.0);
            }
        }
    }

    // The same CreateWithDescription path and unbounded lifetime as caffeinate -i/-di.
    // No UserIsActive assertion, input synthesis, or lock policy changes.
    fn assertion(kind: &'static std::ffi::CStr, name: &'static std::ffi::CStr) -> Result<u32, ()> {
        let kind = OwnedCF::string(kind)?;
        let name = OwnedCF::string(name)?;
        let action = OwnedCF::string(c"TimeoutActionRelease")?;
        let mut id = 0;
        let result = unsafe {
            IOPMAssertionCreateWithDescription(
                kind.0,
                name.0,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                0.0,
                action.0,
                &mut id,
            )
        };
        if result == 0 {
            Ok(id)
        } else {
            Err(())
        }
    }

    // IOReturn.h: an assertion ID which powerd can no longer locate.
    const NOT_FOUND: i32 = 0xe00002f0u32 as i32;
    // powerd lookupAssertion returns BadArgument for an absent ID (observed on 15.7.3).
    const BAD_ARGUMENT: i32 = 0xe00002c2u32 as i32;
    // IOKitUser's asynchronous assertion lookup uses Invalid for a released local ID.
    const INVALID: i32 = 0xe0000001u32 as i32;

    fn inspect(id: u32, kind: AssertionKind) -> Result<AssertionState, ()> {
        let level_key = OwnedCF::string(c"AssertLevel")?;
        let properties = unsafe { IOPMAssertionCopyProperties(id) };
        if properties.is_null() {
            // NULL alone cannot distinguish a missing assertion from an unavailable powerd.
            // Refresh the desired level on this same ID; only an invalid/missing ID result allows forgetting it.
            // A transient read failure keeps the ID and never creates a duplicate assertion.
            let on: i32 = 255;
            let value = unsafe { CFNumberCreate(std::ptr::null(), 3, &on) };
            if value.is_null() {
                return Err(());
            }
            let value = OwnedCF(value);
            let result = unsafe { IOPMAssertionSetProperty(id, level_key.0, value.0) };
            return match result {
                NOT_FOUND | BAD_ARGUMENT | INVALID => Ok(AssertionState::Missing),
                _ => Err(()),
            };
        }
        let properties = OwnedCF(properties);
        let type_key = OwnedCF::string(c"AssertType")?;
        let expected = OwnedCF::string(match kind {
            AssertionKind::System => c"PreventUserIdleSystemSleep",
            AssertionKind::Display => c"PreventUserIdleDisplaySleep",
        })?;
        let name_key = OwnedCF::string(c"AssertName")?;
        let expected_name = OwnedCF::string(match kind {
            AssertionKind::System => c"Relayune: keep computer awake",
            AssertionKind::Display => c"Relayune: prevent automatic screen lock",
        })?;
        let name = unsafe { CFDictionaryGetValue(properties.0, name_key.0) };
        let actual = unsafe { CFDictionaryGetValue(properties.0, type_key.0) };
        let level = unsafe { CFDictionaryGetValue(properties.0, level_key.0) };
        if actual.is_null()
            || name.is_null()
            || level.is_null()
            || unsafe {
                CFGetTypeID(name) != CFStringGetTypeID()
                    || CFGetTypeID(actual) != CFStringGetTypeID()
                    || CFGetTypeID(level) != CFNumberGetTypeID()
            }
        {
            return Err(());
        }
        let mut current: i32 = 0;
        if unsafe { CFNumberGetValue(level, 3, &mut current) } == 0 {
            return Err(());
        }
        // Never release an unrelated assertion if an ID was reused after powerd recovery.
        if unsafe { CFEqual(actual, expected.0) == 0 || CFEqual(name, expected_name.0) == 0 } {
            return Ok(AssertionState::Missing);
        }
        Ok(if current == 255 {
            AssertionState::Active
        } else {
            AssertionState::Inactive
        })
    }

    impl PowerBackend for NativePower {
        fn supported(&self) -> bool {
            true
        }
        fn on_ac_power(&self) -> Result<bool, ()> {
            let info = unsafe { IOPSCopyPowerSourcesInfo() };
            if info.is_null() {
                return Err(());
            }
            let info = OwnedCF(info);
            // Get returns a borrowed string tied to the info snapshot.
            let source = unsafe { IOPSGetProvidingPowerSourceType(info.0) };
            if source.is_null() {
                return Err(());
            }
            let ac = OwnedCF::string(c"AC Power")?;
            Ok(unsafe { CFEqual(source, ac.0) } != 0)
        }
        fn acquire(&mut self) -> Result<u32, ()> {
            assertion(
                c"PreventUserIdleSystemSleep",
                c"Relayune: keep computer awake",
            )
        }
        fn acquire_display(&mut self) -> Result<u32, ()> {
            assertion(
                c"PreventUserIdleDisplaySleep",
                c"Relayune: prevent automatic screen lock",
            )
        }
        fn inspect(&mut self, id: u32, kind: AssertionKind) -> Result<AssertionState, ()> {
            inspect(id, kind)
        }
        fn release(&mut self, id: u32) -> Result<(), ()> {
            if matches!(
                unsafe { IOPMAssertionRelease(id) },
                0 | NOT_FOUND | BAD_ARGUMENT | INVALID
            ) {
                Ok(())
            } else {
                Err(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn native_display_prevention_is_opt_in_and_both_assertions_are_released() {
        // Isolated test process; does not launch/stop Relayune or change system settings.
        let mut c = Controller::new(NativePower, Ok(Mode::Always.into()));
        c.reconcile();
        assert!(c.status().active && !c.status().error);
        let own_assertions = || {
            let output = std::process::Command::new("/usr/bin/pmset")
                .args(["-g", "assertions"])
                .output()
                .unwrap();
            assert!(output.status.success());
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| line.contains(&format!("pid {}(", std::process::id())))
                .map(str::to_owned)
                .collect::<Vec<_>>()
                .join("\n")
        };
        let active = own_assertions();
        assert!(active.contains("PreventUserIdleSystemSleep"));
        assert!(!active.contains("PreventUserIdleDisplaySleep"));
        assert!(!active.contains("UserIsActive"));
        c.set_preference(
            Preferences {
                mode: Mode::Always,
                prevent_lock: true,
            },
            |_| Ok(()),
        )
        .unwrap();
        let active = own_assertions();
        assert!(active.contains("PreventUserIdleDisplaySleep"));
        assert!(active.contains("PreventUserIdleSystemSleep"));
        assert!(!active.contains("UserIsActive"));
        let lost_display = c.display_assertion.unwrap().id;
        c.backend.release(lost_display).unwrap();
        assert_eq!(
            c.backend
                .inspect(lost_display, AssertionKind::Display)
                .unwrap(),
            AssertionState::Missing
        );
        let system_id = c.assertion.unwrap().id;
        c.reconcile();
        assert!(c.status().lock_prevention_active && !c.status().error);
        assert_ne!(c.display_assertion.unwrap().id, lost_display);
        assert_eq!(c.assertion.unwrap().id, system_id);
        c.reconcile();
        let active = own_assertions();
        assert_eq!(
            active.lines().filter(|l| l.contains("Relayune:")).count(),
            2
        );
        c.set_preference(
            Preferences {
                mode: Mode::Off,
                prevent_lock: true,
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(!own_assertions().contains("Relayune:"));
        assert!(c.status().prevent_lock && !c.status().lock_prevention_stopping);
        c.set_preference(
            Preferences {
                mode: Mode::Always,
                prevent_lock: true,
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(c.status().lock_prevention_active);
        c.set_preference(Preferences::default(), |_| Ok(()))
            .unwrap();
        assert!(!own_assertions().contains("Relayune:"));
    }

    #[derive(Default)]
    struct FakePower {
        ac: Option<bool>,
        creates: usize,
        releases: usize,
        fail_create: bool,
        fail_display: bool,
        fail_release: bool,
        fail_inspect: bool,
        missing: std::collections::HashSet<u32>,
        inactive: std::collections::HashSet<u32>,
    }
    impl PowerBackend for FakePower {
        fn supported(&self) -> bool {
            true
        }
        fn on_ac_power(&self) -> Result<bool, ()> {
            self.ac.ok_or(())
        }
        fn acquire(&mut self) -> Result<u32, ()> {
            if self.fail_create {
                return Err(());
            }
            self.creates += 1;
            Ok(self.creates as u32)
        }
        fn acquire_display(&mut self) -> Result<u32, ()> {
            if self.fail_display {
                Err(())
            } else {
                self.acquire()
            }
        }
        fn inspect(&mut self, id: u32, _kind: AssertionKind) -> Result<AssertionState, ()> {
            if self.fail_inspect {
                Err(())
            } else if self.missing.contains(&id) {
                Ok(AssertionState::Missing)
            } else if self.inactive.contains(&id) {
                Ok(AssertionState::Inactive)
            } else {
                Ok(AssertionState::Active)
            }
        }
        fn release(&mut self, _: u32) -> Result<(), ()> {
            if self.fail_release {
                return Err(());
            }
            self.releases += 1;
            Ok(())
        }
    }
    #[test]
    fn ac_mode_tracks_unplug_replug_and_unknown_power_without_duplicate_holds() {
        let mut c = Controller::new(
            FakePower {
                ac: Some(true),
                ..Default::default()
            },
            Ok(Mode::AcPower.into()),
        );
        c.reconcile();
        c.reconcile();
        assert!(c.status().active);
        assert_eq!(c.backend.creates, 1);
        c.backend.ac = Some(false);
        c.reconcile();
        assert!(!c.status().active);
        assert_eq!(c.backend.releases, 1);
        c.backend.ac = Some(true);
        c.reconcile();
        assert!(c.status().active);
        c.backend.ac = None;
        c.reconcile();
        assert!(!c.status().active);
        assert!(c.status().error);
        c.backend.ac = Some(true);
        c.reconcile();
        assert!(c.status().active);
        assert!(!c.status().error);
    }
    #[test]
    fn always_ignores_power_source_and_off_releases() {
        let mut c = Controller::new(FakePower::default(), Ok(Mode::Always.into()));
        c.reconcile();
        assert!(c.status().active);
        c.set_preference(Mode::Off.into(), |_| Ok(())).unwrap();
        assert!(!c.status().active);
        assert_eq!(c.backend.releases, 1);
    }
    #[test]
    fn failed_save_keeps_previous_preference_and_hold() {
        let mut c = Controller::new(FakePower::default(), Ok(Mode::Always.into()));
        c.reconcile();
        assert!(c.set_preference(Mode::Off.into(), |_| Err(())).is_err());
        assert_eq!(c.status().mode, Mode::Always);
        assert!(c.status().active);
    }
    #[test]
    fn native_failure_is_visible_and_retried_including_failed_release() {
        let mut c = Controller::new(
            FakePower {
                fail_create: true,
                ..Default::default()
            },
            Ok(Mode::Always.into()),
        );
        c.reconcile();
        assert!(c.status().error);
        assert!(!c.status().active);
        c.backend.fail_create = false;
        c.reconcile();
        assert!(c.status().active);
        c.backend.fail_release = true;
        c.set_preference(Mode::Off.into(), |_| Ok(())).unwrap();
        assert!(c.status().active);
        assert!(c.status().error);
        c.backend.fail_release = false;
        c.reconcile();
        assert!(!c.status().active);
        assert!(!c.status().error);
    }
    #[test]
    fn missing_preference_defaults_off_and_corrupt_preference_is_reported() {
        let dir = std::env::temp_dir().join(format!(
            "relayune-keep-awake-{:016x}",
            rand::random::<u64>()
        ));
        let path = dir.join("keep-awake.json");
        assert_eq!(load(&path), Ok(Mode::Off.into()));
        save(&path, Mode::AcPower.into()).unwrap();
        assert_eq!(load(&path), Ok(Mode::AcPower.into()));
        save(&path, Mode::Always.into()).unwrap();
        assert_eq!(load(&path), Ok(Mode::Always.into()));
        fs::write(&path, b"broken").unwrap();
        let mut c = Controller::new(FakePower::default(), load(&path));
        c.reconcile();
        assert_eq!(c.status().mode, Mode::Off);
        assert!(c.status().error);
        c.set_preference(Mode::Off.into(), |mode| save(&path, mode))
            .unwrap();
        assert!(!c.status().error);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn lock_prevention_follows_mode_and_power_without_losing_preference() {
        let mut c = Controller::new(
            FakePower {
                ac: Some(false),
                ..Default::default()
            },
            Ok(Preferences {
                mode: Mode::AcPower,
                prevent_lock: true,
            }),
        );
        c.reconcile();
        assert!(!c.status().active && !c.status().lock_prevention_active && !c.status().error);
        assert_eq!(c.backend.creates, 0);
        c.backend.ac = Some(true);
        c.reconcile();
        c.reconcile();
        assert!(c.status().active && c.status().lock_prevention_active);
        assert_eq!(c.backend.creates, 2);
        c.backend.ac = Some(false);
        c.reconcile();
        assert!(!c.status().active && !c.status().lock_prevention_active);
        assert!(c.status().prevent_lock && !c.status().lock_prevention_stopping);
        assert_eq!(c.backend.releases, 2);
        c.set_preference(
            Preferences {
                mode: Mode::Always,
                prevent_lock: true,
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(c.status().active && c.status().lock_prevention_active);
        c.set_preference(
            Preferences {
                mode: Mode::Off,
                prevent_lock: true,
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(
            !c.status().active && !c.status().lock_prevention_active && c.status().prevent_lock
        );
        assert_eq!(c.backend.releases, 4);
        c.set_preference(
            Preferences {
                mode: Mode::AcPower,
                prevent_lock: true,
            },
            |_| Ok(()),
        )
        .unwrap();
        c.backend.ac = Some(true);
        c.reconcile();
        c.backend.ac = None;
        c.reconcile();
        assert!(c.status().error && c.status().prevent_lock);
        assert!(!c.status().active && !c.status().lock_prevention_active);
        c.backend.ac = Some(true);
        c.reconcile();
        assert!(c.status().lock_prevention_active && !c.status().error);
        c.backend.fail_release = true;
        c.backend.ac = Some(false);
        c.reconcile();
        assert!(c.status().lock_prevention_stopping && c.status().error);
        c.backend.fail_release = false;
        c.reconcile();
        assert!(!c.status().lock_prevention_stopping && !c.status().active);
        c.backend.ac = Some(true);
        c.reconcile();
        let system_id = c.assertion.unwrap().id;
        c.set_preference(
            Preferences {
                mode: Mode::AcPower,
                prevent_lock: false,
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(c.status().active && !c.status().lock_prevention_active);
        assert_eq!(c.assertion.unwrap().id, system_id);
    }

    #[test]
    fn failed_display_hold_is_truthful_and_retries_without_duplicating_system_hold() {
        let mut c = Controller::new(
            FakePower {
                fail_display: true,
                ..Default::default()
            },
            Ok(Preferences {
                mode: Mode::Always,
                prevent_lock: true,
            }),
        );
        c.reconcile();
        assert!(c.status().prevent_lock && c.status().error && c.status().active);
        assert!(!c.status().lock_prevention_active);
        assert_eq!(c.backend.creates, 1);
        c.backend.fail_display = false;
        c.reconcile();
        assert!(c.status().lock_prevention_active && !c.status().error);
        assert_eq!(c.backend.creates, 2);
        assert!(c
            .set_preference(Preferences::default(), |_| Err(()))
            .is_err());
        assert!(c.status().prevent_lock && c.status().lock_prevention_active);
        c.backend.fail_release = true;
        c.set_preference(Preferences::default(), |_| Ok(()))
            .unwrap();
        assert!(c.status().error && c.status().lock_prevention_active);
        c.backend.fail_release = false;
        c.reconcile();
        assert!(!c.status().error && !c.status().active && !c.status().lock_prevention_active);
    }

    #[test]
    fn legacy_preferences_migrate_without_enabling_screen_prevention_and_new_choice_persists() {
        let dir = std::env::temp_dir().join(format!(
            "relayune-lock-preference-{:016x}",
            rand::random::<u64>()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("keep-awake.json");
        fs::write(&path, b"\"always\"").unwrap();
        assert_eq!(load(&path), Ok(Mode::Always.into()));
        let selected = Preferences {
            mode: Mode::AcPower,
            prevent_lock: true,
        };
        save(&path, selected).unwrap();
        let mut resumed = Controller::new(
            FakePower {
                ac: Some(false),
                ..Default::default()
            },
            load(&path),
        );
        resumed.reconcile();
        assert_eq!(resumed.preference, selected);
        assert!(!resumed.status().lock_prevention_active && !resumed.status().active);
        resumed.backend.ac = Some(true);
        resumed.reconcile();
        assert!(resumed.status().lock_prevention_active && resumed.status().active);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn missing_and_inactive_assertions_recover_individually_without_periodic_recreation() {
        let mut c = Controller::new(
            FakePower::default(),
            Ok(Preferences {
                mode: Mode::Always,
                prevent_lock: true,
            }),
        );
        c.reconcile();
        let first_display = c.display_assertion.unwrap().id;
        let first_system = c.assertion.unwrap().id;
        c.backend.missing.insert(first_display);
        c.reconcile();
        assert_eq!(c.assertion.unwrap().id, first_system);
        assert_ne!(c.display_assertion.unwrap().id, first_display);
        assert_eq!(c.backend.creates, 3);
        assert_eq!(c.backend.releases, 0);
        c.backend.inactive.insert(first_system);
        c.reconcile();
        assert_eq!(c.backend.creates, 4);
        assert_eq!(c.backend.releases, 1);
        assert!(c.status().lock_prevention_active && !c.status().error);
        c.reconcile();
        assert_eq!(c.backend.creates, 4);
    }

    #[test]
    fn unreadable_assertions_are_not_claimed_active_or_duplicated_and_can_recover() {
        let mut c = Controller::new(
            FakePower::default(),
            Ok(Preferences {
                mode: Mode::Always,
                prevent_lock: true,
            }),
        );
        c.reconcile();
        c.backend.fail_inspect = true;
        c.reconcile();
        c.reconcile();
        assert!(!c.status().active && !c.status().lock_prevention_active && c.status().error);
        assert_eq!(c.backend.creates, 2);
        c.backend.fail_inspect = false;
        c.reconcile();
        assert!(c.status().active && c.status().lock_prevention_active && !c.status().error);
        assert_eq!(c.backend.creates, 2);
        c.backend.fail_release = true;
        c.set_preference(Preferences::default(), |_| Ok(()))
            .unwrap();
        assert!(c.status().lock_prevention_stopping && c.status().error);
        c.backend.fail_release = false;
        c.reconcile();
        assert!(!c.status().lock_prevention_stopping && !c.status().active);
    }
}
