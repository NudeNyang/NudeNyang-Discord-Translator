//! Window focus selects work, never launch time. Opening settings keeps the
//! last target for status/recovery without granting permission to scan it.
use crate::discord::DiscordVariant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FocusTarget {
    pub selected: Option<DiscordVariant>,
    pub active: bool,
}

pub fn select_target(
    configured: DiscordVariant,
    foreground: Option<DiscordVariant>,
    previous: Option<DiscordVariant>,
) -> FocusTarget {
    let allowed = |variant: &DiscordVariant| {
        *variant != DiscordVariant::Auto
            && (configured == DiscordVariant::Auto || *variant == configured)
    };
    let foreground = foreground.filter(allowed);
    FocusTarget {
        selected: foreground
            .or(previous.filter(allowed))
            .or_else(|| (configured != DiscordVariant::Auto).then_some(configured)),
        active: foreground.is_some(),
    }
}

#[cfg(windows)]
pub fn foreground_process_id() -> Option<u32> {
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut core::ffi::c_void;
        fn GetWindowThreadProcessId(window: *mut core::ffi::c_void, process: *mut u32) -> u32;
    }
    let mut process = 0;
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }
        GetWindowThreadProcessId(window, &mut process);
    }
    (process != 0).then_some(process)
}

#[cfg(not(windows))]
pub fn foreground_process_id() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use DiscordVariant::*;

    #[test]
    fn focus_follows_each_release_and_never_launch_order() {
        let mut previous = None;
        for variant in [Stable, Canary, Ptb, Stable] {
            let target = select_target(Auto, Some(variant), previous);
            assert_eq!(
                target,
                FocusTarget {
                    selected: Some(variant),
                    active: true
                }
            );
            previous = target.selected;
        }
    }

    #[test]
    fn other_apps_pause_work_but_keep_last_target_for_settings() {
        assert_eq!(
            select_target(Auto, None, Some(Ptb)),
            FocusTarget {
                selected: Some(Ptb),
                active: false
            }
        );
        assert_eq!(
            select_target(Auto, None, None),
            FocusTarget {
                selected: None,
                active: false
            }
        );
    }

    #[test]
    fn explicit_selection_ignores_other_releases() {
        assert_eq!(
            select_target(Stable, Some(Canary), Some(Ptb)),
            FocusTarget {
                selected: Some(Stable),
                active: false
            }
        );
        assert!(select_target(Stable, Some(Stable), None).active);
    }
}
