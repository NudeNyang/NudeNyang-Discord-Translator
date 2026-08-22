use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use tauri::AppHandle;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(3);

// Speech commands are low-frequency worker messages. Keeping AppHandle inline avoids an
// extra allocation and makes the request lifetime explicit.
#[allow(clippy::large_enum_variant)]
enum SpeechCommand {
    Play {
        app: AppHandle,
        text: String,
        language: String,
        request_id: String,
        reply: Sender<Result<bool, String>>,
    },
    Pause(Sender<Result<(), String>>),
    Resume(Sender<Result<(), String>>),
    Stop(Sender<Result<(), String>>),
}

pub struct NativeSpeechState {
    sender: Sender<SpeechCommand>,
}

impl Default for NativeSpeechState {
    fn default() -> Self {
        let (sender, receiver) = mpsc::channel();
        std::thread::Builder::new()
            .name("nudenyang-native-speech".to_string())
            .spawn(move || speech_worker(receiver))
            .expect("native speech worker should start");
        Self { sender }
    }
}

impl NativeSpeechState {
    pub fn play(
        &self,
        app: AppHandle,
        text: String,
        language: String,
        request_id: String,
    ) -> Result<bool, String> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(SpeechCommand::Play {
                app,
                text,
                language,
                request_id,
                reply,
            })
            .map_err(|_| "운영체제 음성 합성 작업이 종료되었습니다.".to_string())?;
        response
            .recv_timeout(COMMAND_TIMEOUT)
            .map_err(|_| "운영체제 음성 합성 시작을 기다리지 못했습니다.".to_string())?
    }

    pub fn pause(&self) -> Result<(), String> {
        self.control(SpeechCommand::Pause)
    }

    pub fn resume(&self) -> Result<(), String> {
        self.control(SpeechCommand::Resume)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.control(SpeechCommand::Stop)
    }

    fn control(
        &self,
        command: fn(Sender<Result<(), String>>) -> SpeechCommand,
    ) -> Result<(), String> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(command(reply))
            .map_err(|_| "운영체제 음성 합성 작업이 종료되었습니다.".to_string())?;
        response
            .recv_timeout(COMMAND_TIMEOUT)
            .map_err(|_| "운영체제 음성 합성 응답을 기다리지 못했습니다.".to_string())?
    }
}

#[cfg(not(windows))]
fn speech_worker(receiver: Receiver<SpeechCommand>) {
    for command in receiver {
        match command {
            SpeechCommand::Play { reply, .. } => {
                let _ = reply.send(Ok(false));
            }
            SpeechCommand::Pause(reply)
            | SpeechCommand::Resume(reply)
            | SpeechCommand::Stop(reply) => {
                let _ = reply.send(Ok(()));
            }
        }
    }
}

#[cfg(windows)]
mod windows_speech {
    use super::{Receiver, SpeechCommand};
    use std::ptr;
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::{Duration, Instant};

    use tauri::Emitter;
    use windows::core::PCWSTR;
    use windows::Win32::Globalization::{LocaleNameToLCID, LOCALE_ALLOW_NEUTRAL_NAMES};
    use windows::Win32::Media::Speech::{
        ISpObjectToken, ISpObjectTokenCategory, ISpVoice, SpObjectTokenCategory, SpVoice,
        SPCAT_VOICES, SPF_ASYNC, SPF_PURGEBEFORESPEAK, SPRS_DONE, SPVOICESTATUS,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    const POLL_INTERVAL: Duration = Duration::from_millis(40);
    const STARTUP_TIMEOUT: Duration = Duration::from_secs(3);
    const WINDOW_LABEL: &str = "dictionary";
    const ENDED_EVENT: &str = "dictionary-speech-ended";

    struct ActiveSpeech {
        app: tauri::AppHandle,
        request_id: String,
        paused: bool,
        started_at: Instant,
        observed_running: bool,
    }

    struct ComApartment;

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn language_attribute(locale: &str) -> Result<String, String> {
        let locale_wide = wide(locale);
        let lcid =
            unsafe { LocaleNameToLCID(PCWSTR(locale_wide.as_ptr()), LOCALE_ALLOW_NEUTRAL_NAMES) };
        if lcid == 0 {
            return Err(format!("지원되지 않는 음성 언어 코드입니다: {locale}"));
        }
        Ok(format!("Language={:X}", lcid & 0xFFFF))
    }

    unsafe fn voice_token(
        category: &ISpObjectTokenCategory,
        locale: &str,
    ) -> Result<ISpObjectToken, String> {
        let attribute = wide(&language_attribute(locale)?);
        let tokens = unsafe { category.EnumTokens(PCWSTR(attribute.as_ptr()), PCWSTR::null()) }
            .map_err(|error| format!("{locale} 음성 목록을 확인하지 못했습니다: {error}"))?;
        let mut count = 0;
        unsafe { tokens.GetCount(&mut count) }
            .map_err(|error| format!("{locale} 음성 수를 확인하지 못했습니다: {error}"))?;
        if count == 0 {
            return Err(format!("{locale} 음성이 Windows에 설치되어 있지 않습니다."));
        }
        unsafe { tokens.Item(0) }
            .map_err(|error| format!("{locale} 음성을 선택하지 못했습니다: {error}"))
    }

    unsafe fn purge(voice: &ISpVoice) -> Result<(), String> {
        unsafe { voice.Speak(PCWSTR::null(), SPF_PURGEBEFORESPEAK.0 as u32, None) }
            .map_err(|error| format!("음성 재생을 중지하지 못했습니다: {error}"))
    }

    fn speech_finished(
        observed_running: &mut bool,
        running_state: u32,
        startup_timed_out: bool,
    ) -> bool {
        if running_state != SPRS_DONE.0 as u32 {
            *observed_running = true;
            false
        } else {
            *observed_running || startup_timed_out
        }
    }

    fn failed_worker(receiver: Receiver<SpeechCommand>, error: String) {
        for command in receiver {
            match command {
                SpeechCommand::Play { reply, .. } => {
                    let _ = reply.send(Err(error.clone()));
                }
                SpeechCommand::Pause(reply)
                | SpeechCommand::Resume(reply)
                | SpeechCommand::Stop(reply) => {
                    let _ = reply.send(Err(error.clone()));
                }
            }
        }
    }

    pub(super) fn run(receiver: Receiver<SpeechCommand>) {
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if let Err(error) = initialized.ok() {
            failed_worker(
                receiver,
                format!("Windows 음성 합성을 초기화하지 못했습니다: {error}"),
            );
            return;
        }
        let _com_apartment = ComApartment;

        let voice: ISpVoice = match unsafe { CoCreateInstance(&SpVoice, None, CLSCTX_ALL) } {
            Ok(voice) => voice,
            Err(error) => {
                failed_worker(
                    receiver,
                    format!("Windows 음성 합성기를 만들지 못했습니다: {error}"),
                );
                return;
            }
        };
        let category: ISpObjectTokenCategory =
            match unsafe { CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL) } {
                Ok(category) => category,
                Err(error) => {
                    failed_worker(
                        receiver,
                        format!("Windows 음성 목록을 열지 못했습니다: {error}"),
                    );
                    return;
                }
            };
        if let Err(error) = unsafe { category.SetId(SPCAT_VOICES, false) } {
            failed_worker(
                receiver,
                format!("Windows 음성 목록을 지정하지 못했습니다: {error}"),
            );
            return;
        }

        let mut active: Option<ActiveSpeech> = None;
        loop {
            match receiver.recv_timeout(POLL_INTERVAL) {
                Ok(SpeechCommand::Play {
                    app,
                    text,
                    language,
                    request_id,
                    reply,
                }) => {
                    let result = (|| {
                        unsafe { purge(&voice) }?;
                        active = None;
                        let token = unsafe { voice_token(&category, &language) }?;
                        unsafe { voice.SetVoice(&token) }.map_err(|error| {
                            format!("{language} 음성을 적용하지 못했습니다: {error}")
                        })?;
                        let text_wide = wide(&text);
                        unsafe {
                            voice.Speak(
                                PCWSTR(text_wide.as_ptr()),
                                (SPF_ASYNC.0 | SPF_PURGEBEFORESPEAK.0) as u32,
                                None,
                            )
                        }
                        .map_err(|error| format!("발음을 재생하지 못했습니다: {error}"))?;
                        active = Some(ActiveSpeech {
                            app,
                            request_id,
                            paused: false,
                            started_at: Instant::now(),
                            observed_running: false,
                        });
                        Ok(true)
                    })();
                    let _ = reply.send(result);
                }
                Ok(SpeechCommand::Pause(reply)) => {
                    let result = if let Some(current) = active.as_mut() {
                        match unsafe { voice.Pause() } {
                            Ok(()) => {
                                current.paused = true;
                                Ok(())
                            }
                            Err(error) => Err(format!("발음을 일시정지하지 못했습니다: {error}")),
                        }
                    } else {
                        Ok(())
                    };
                    let _ = reply.send(result);
                }
                Ok(SpeechCommand::Resume(reply)) => {
                    let result = if let Some(current) = active.as_mut() {
                        match unsafe { voice.Resume() } {
                            Ok(()) => {
                                current.paused = false;
                                Ok(())
                            }
                            Err(error) => Err(format!("발음을 다시 재생하지 못했습니다: {error}")),
                        }
                    } else {
                        Ok(())
                    };
                    let _ = reply.send(result);
                }
                Ok(SpeechCommand::Stop(reply)) => {
                    active = None;
                    let _ = reply.send(unsafe { purge(&voice) });
                }
                Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {}
            }

            let finished = if active.as_ref().is_some_and(|current| !current.paused) {
                let mut status = SPVOICESTATUS::default();
                if unsafe { voice.GetStatus(&mut status, ptr::null_mut()) }.is_ok() {
                    let current = active.as_mut().expect("active speech should exist");
                    speech_finished(
                        &mut current.observed_running,
                        status.dwRunningState,
                        current.started_at.elapsed() >= STARTUP_TIMEOUT,
                    )
                } else {
                    false
                }
            } else {
                false
            };
            if finished {
                if let Some(completed) = active.take() {
                    let _ = completed
                        .app
                        .emit_to(WINDOW_LABEL, ENDED_EVENT, completed.request_id);
                }
            }
        }

        let _ = unsafe { purge(&voice) };
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn regional_locales_map_to_sapi_language_attributes() {
            assert_eq!(language_attribute("en-US").unwrap(), "Language=409");
            assert_eq!(language_attribute("ko-KR").unwrap(), "Language=412");
            assert_eq!(language_attribute("ja-JP").unwrap(), "Language=411");
        }

        #[test]
        fn initial_done_state_does_not_end_speech_before_sapi_starts() {
            let mut observed_running = false;

            assert!(!speech_finished(
                &mut observed_running,
                SPRS_DONE.0 as u32,
                false
            ));
            assert!(!speech_finished(&mut observed_running, 2, false));
            assert!(observed_running);
            assert!(speech_finished(
                &mut observed_running,
                SPRS_DONE.0 as u32,
                false
            ));
        }

        #[test]
        fn speech_start_timeout_recovers_if_sapi_never_runs() {
            let mut observed_running = false;

            assert!(speech_finished(
                &mut observed_running,
                SPRS_DONE.0 as u32,
                true
            ));
        }

        #[test]
        #[ignore = "requires an installed English Windows voice"]
        fn installed_english_voice_is_visible_to_native_sapi() {
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
                .ok()
                .unwrap();
            let _com_apartment = ComApartment;
            let category: ISpObjectTokenCategory =
                unsafe { CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL) }.unwrap();
            unsafe { category.SetId(SPCAT_VOICES, false) }.unwrap();
            let token = unsafe { voice_token(&category, "en-US") }.unwrap();
            let voice: ISpVoice = unsafe { CoCreateInstance(&SpVoice, None, CLSCTX_ALL) }.unwrap();
            unsafe { voice.SetVoice(&token) }.unwrap();
            let sample = wide("Pronunciation test");
            unsafe { voice.Speak(PCWSTR(sample.as_ptr()), 0, None) }.unwrap();
        }

        #[test]
        #[ignore = "requires an installed English Windows voice and audio output"]
        fn installed_english_voice_speaks_a_long_sentence_asynchronously() {
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
                .ok()
                .unwrap();
            let _com_apartment = ComApartment;
            let category: ISpObjectTokenCategory =
                unsafe { CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL) }.unwrap();
            unsafe { category.SetId(SPCAT_VOICES, false) }.unwrap();
            let token = unsafe { voice_token(&category, "en-US") }.unwrap();
            let voice: ISpVoice = unsafe { CoCreateInstance(&SpVoice, None, CLSCTX_ALL) }.unwrap();
            unsafe { voice.SetVoice(&token) }.unwrap();

            {
                let sample = wide(
                    "This is a longer pronunciation test that verifies a complete sentence can be spoken clearly without stopping early.",
                );
                unsafe { voice.Speak(PCWSTR(sample.as_ptr()), SPF_ASYNC.0 as u32, None) }.unwrap();
            }

            unsafe { voice.WaitUntilDone(30_000) }.unwrap();
            let mut status = SPVOICESTATUS::default();
            unsafe { voice.GetStatus(&mut status, ptr::null_mut()) }.unwrap();
            assert_eq!(status.dwRunningState, SPRS_DONE.0 as u32);
        }
    }
}

#[cfg(windows)]
fn speech_worker(receiver: Receiver<SpeechCommand>) {
    windows_speech::run(receiver);
}
