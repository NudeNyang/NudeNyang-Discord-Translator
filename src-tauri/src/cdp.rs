use std::fs::File;
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tungstenite::{client, Message, WebSocket};
use url::Url;

const MAX_CDP_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CdpTarget {
    #[serde(rename = "id", alias = "targetId", default)]
    pub target_id: String,
    #[serde(rename = "type", default)]
    pub target_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl", default)]
    pub websocket_url: String,
}

pub fn list_targets(port: u16) -> Result<Vec<CdpTarget>, String> {
    let response = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| format!("CDP 검색 클라이언트를 만들지 못했습니다: {error}"))?
        .get(format!("http://127.0.0.1:{port}/json/list"))
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Discord 디버그 대상을 조회하지 못했습니다: {error}"))?;
    let targets: Vec<CdpTarget> = response
        .json()
        .map_err(|error| format!("Discord 디버그 대상 목록을 읽지 못했습니다: {error}"))?;
    Ok(targets
        .into_iter()
        .filter(|target| local_websocket_matches_port(&target.websocket_url, port))
        .collect())
}

pub fn discord_target(port: u16) -> Result<CdpTarget, String> {
    select_discord_target(list_targets(port)?)
}

fn select_discord_target(targets: Vec<CdpTarget>) -> Result<CdpTarget, String> {
    if let Some(target) = targets.iter().find(|target| {
        target.target_type == "page"
            && discord_page_url(&target.url).is_some_and(|url| url.path().starts_with("/channels/"))
    }) {
        return Ok(target.clone());
    }
    if let Some(target) = targets.iter().find(|target| {
        target.target_type == "page"
            && discord_page_url(&target.url).is_some_and(|url| !url.path().contains("/popout"))
    }) {
        return Ok(target.clone());
    }
    let details = targets
        .iter()
        .map(|target| format!("{:?} {:?}", target.title, target.url))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Discord 렌더러 대상을 찾지 못했습니다: {}",
        if details.is_empty() {
            "대상 없음"
        } else {
            &details
        }
    ))
}

fn discord_page_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("discord.com"))
        && url.port_or_known_default() == Some(443))
    .then_some(url)
}

fn local_websocket_matches_port(value: &str, expected_port: u16) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "ws" || url.port_or_known_default() != Some(expected_port) {
        return false;
    }
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback()),
        None => false,
    }
}

struct PipeTransport {
    reader: File,
    writer: File,
    buffered: Vec<u8>,
}

impl PipeTransport {
    fn new(reader: File, writer: File) -> Self {
        Self {
            reader,
            writer,
            buffered: Vec::new(),
        }
    }

    fn send(&mut self, payload: &Value) -> Result<(), String> {
        self.writer
            .write_all(payload.to_string().as_bytes())
            .and_then(|_| self.writer.write_all(&[0]))
            .and_then(|_| self.writer.flush())
            .map_err(|error| format!("CDP 파이프 요청을 보내지 못했습니다: {error}"))
    }

    #[cfg(windows)]
    fn read(&mut self, timeout: Duration) -> Result<Value, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::Pipes::PeekNamedPipe;

        let deadline = Instant::now() + timeout;
        loop {
            if let Some(terminator) = self.buffered.iter().position(|byte| *byte == 0) {
                let bytes = self.buffered.drain(..terminator).collect::<Vec<_>>();
                self.buffered.drain(..1);
                return serde_json::from_slice(&bytes)
                    .map_err(|error| format!("CDP 파이프 응답 형식이 올바르지 않습니다: {error}"));
            }
            if Instant::now() >= deadline {
                return Err("CDP 파이프 응답 시간이 초과됐습니다.".to_string());
            }

            let mut available = 0_u32;
            let ok = unsafe {
                PeekNamedPipe(
                    self.reader.as_raw_handle(),
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    &mut available,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(format!(
                    "CDP 파이프 상태를 읽지 못했습니다: {}",
                    std::io::Error::last_os_error()
                ));
            }
            if available == 0 {
                thread::sleep(Duration::from_millis(10));
                continue;
            }
            let mut chunk = vec![0_u8; available.min(64 * 1024) as usize];
            let read = self
                .reader
                .read(&mut chunk)
                .map_err(|error| format!("CDP 파이프 응답을 읽지 못했습니다: {error}"))?;
            if read == 0 {
                return Err("Discord가 CDP 파이프 연결을 닫았습니다.".to_string());
            }
            self.buffered.extend_from_slice(&chunk[..read]);
            if self.buffered.len() > MAX_CDP_RESPONSE_BYTES {
                self.buffered.clear();
                return Err("Discord CDP 응답이 허용 크기(32MB)를 초과했습니다.".to_string());
            }
        }
    }

    #[cfg(not(windows))]
    fn read(&mut self, _timeout: Duration) -> Result<Value, String> {
        Err("CDP 보안 파이프는 Windows에서만 지원됩니다.".to_string())
    }
}

pub struct CdpClient {
    websocket_url: Option<String>,
    timeout: Duration,
    next_id: u64,
    socket: Option<WebSocket<TcpStream>>,
    pipe: Option<PipeTransport>,
    session_id: Option<String>,
}

impl CdpClient {
    pub fn new(websocket_url: impl Into<String>) -> Self {
        Self {
            websocket_url: Some(websocket_url.into()),
            timeout: Duration::from_secs(10),
            next_id: 0,
            socket: None,
            pipe: None,
            session_id: None,
        }
    }

    pub fn from_pipe(reader: File, writer: File) -> Self {
        Self {
            websocket_url: None,
            timeout: Duration::from_secs(10),
            next_id: 0,
            socket: None,
            pipe: Some(PipeTransport::new(reader, writer)),
            session_id: None,
        }
    }

    pub fn connect(&mut self) -> Result<(), String> {
        if self.pipe.is_some() {
            if self.session_id.is_some() {
                return Ok(());
            }
            let result = self.raw_call("Target.getTargets", json!({}), None)?;
            let targets: Vec<CdpTarget> = serde_json::from_value(
                result
                    .get("targetInfos")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            )
            .map_err(|error| format!("Discord CDP 대상 목록이 올바르지 않습니다: {error}"))?;
            let target = select_discord_target(targets)?;
            if target.target_id.is_empty() {
                return Err("Discord CDP 대상 ID가 없습니다.".to_string());
            }
            let attached = self.raw_call(
                "Target.attachToTarget",
                json!({"targetId": target.target_id, "flatten": true}),
                None,
            )?;
            let session_id = attached
                .get("sessionId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Discord CDP 세션 ID를 받지 못했습니다.".to_string())?;
            self.session_id = Some(session_id.to_string());
            return Ok(());
        }
        if self.socket.is_some() {
            return Ok(());
        }
        let websocket_url = self
            .websocket_url
            .as_deref()
            .ok_or_else(|| "CDP 연결 주소가 없습니다.".to_string())?;
        let url = Url::parse(websocket_url)
            .map_err(|error| format!("CDP WebSocket 주소가 올바르지 않습니다: {error}"))?;
        if url.scheme() != "ws" {
            return Err("로컬 Discord CDP는 ws:// 주소여야 합니다.".to_string());
        }
        let host = url
            .host_str()
            .ok_or_else(|| "CDP WebSocket 호스트가 없습니다.".to_string())?;
        if host != "localhost"
            && !host
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_loopback())
        {
            return Err("Discord CDP WebSocket은 로컬 호스트만 허용됩니다.".to_string());
        }
        let port = url
            .port_or_known_default()
            .ok_or_else(|| "CDP WebSocket 포트가 없습니다.".to_string())?;
        let address = first_address(host, port)?;
        let stream = TcpStream::connect_timeout(&address, self.timeout)
            .map_err(|error| format!("Discord CDP WebSocket에 연결하지 못했습니다: {error}"))?;
        stream
            .set_read_timeout(Some(self.timeout))
            .and_then(|_| stream.set_write_timeout(Some(self.timeout)))
            .map_err(|error| format!("CDP WebSocket 타임아웃을 설정하지 못했습니다: {error}"))?;
        let (socket, _) = client(websocket_url, stream)
            .map_err(|error| format!("Discord CDP WebSocket 연결에 실패했습니다: {error}"))?;
        self.socket = Some(socket);
        Ok(())
    }

    pub fn close(&mut self) {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close(None);
        }
        self.pipe.take();
        self.session_id = None;
    }

    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.connect()?;
        let session_id = self.session_id.clone();
        self.raw_call(method, params, session_id.as_deref())
    }

    fn raw_call(
        &mut self,
        method: &str,
        params: Value,
        session_id: Option<&str>,
    ) -> Result<Value, String> {
        self.next_id += 1;
        let request_id = self.next_id;
        let mut payload = json!({
            "id": request_id,
            "method": method,
            "params": params,
        });
        if let Some(session_id) = session_id {
            payload["sessionId"] = json!(session_id);
        }

        if let Some(pipe) = self.pipe.as_mut() {
            pipe.send(&payload)?;
            loop {
                let response = pipe.read(self.timeout)?;
                if response.get("id").and_then(Value::as_u64) != Some(request_id) {
                    continue;
                }
                return response_result(method, response);
            }
        }

        let socket = self
            .socket
            .as_mut()
            .ok_or_else(|| "CDP WebSocket이 연결되지 않았어.".to_string())?;
        socket
            .send(Message::Text(payload.to_string().into()))
            .map_err(|error| format!("CDP {method} 요청을 보내지 못했습니다: {error}"))?;
        loop {
            let message = socket
                .read()
                .map_err(|error| format!("CDP {method} 응답을 읽지 못했습니다: {error}"))?;
            let Message::Text(text) = message else {
                continue;
            };
            let response: Value = serde_json::from_str(&text)
                .map_err(|error| format!("CDP {method} 응답 형식이 올바르지 않습니다: {error}"))?;
            if response.get("id").and_then(Value::as_u64) != Some(request_id) {
                continue;
            }
            return response_result(method, response);
        }
    }

    pub fn evaluate(&mut self, expression: &str, await_promise: bool) -> Result<Value, String> {
        let result = self.call(
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": await_promise,
                "userGesture": false,
            }),
        )?;
        if let Some(details) = result.get("exceptionDetails") {
            let description = details
                .get("exception")
                .and_then(|exception| exception.get("description"))
                .or_else(|| details.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("JavaScript 오류");
            return Err(description.to_string());
        }
        Ok(result
            .get("result")
            .and_then(|result| result.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }
}

impl Drop for CdpClient {
    fn drop(&mut self) {
        self.close();
    }
}

fn response_result(method: &str, response: Value) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        return Err(format!("CDP {method} 실패: {error}"));
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

fn first_address(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("CDP WebSocket 주소를 해석하지 못했습니다: {error}"))?
        .find(|address| address.ip().is_loopback())
        .ok_or_else(|| "로컬 CDP WebSocket 주소를 찾지 못했습니다.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{local_websocket_matches_port, select_discord_target, CdpTarget};

    fn target(id: &str, kind: &str, title: &str, url: &str) -> CdpTarget {
        CdpTarget {
            target_id: id.to_string(),
            target_type: kind.to_string(),
            title: title.to_string(),
            url: url.to_string(),
            websocket_url: "ws://127.0.0.1:49152/devtools/page/1".to_string(),
        }
    }

    #[test]
    fn discord_channel_page_is_preferred() {
        let selected = select_discord_target(vec![
            target(
                "settings",
                "page",
                "Settings",
                "https://discord.com/settings",
            ),
            target(
                "channel",
                "page",
                "Discord",
                "https://discord.com/channels/1/2",
            ),
        ])
        .unwrap();
        assert_eq!(selected.target_id, "channel");
    }

    #[test]
    fn non_page_and_lookalike_origins_are_rejected() {
        let error = select_discord_target(vec![
            target(
                "worker",
                "service_worker",
                "Discord",
                "https://discord.com/channels/1/2",
            ),
            target(
                "evil",
                "page",
                "Discord",
                "https://discord.com.evil.example/channels/1/2",
            ),
        ])
        .unwrap_err();
        assert!(error.contains("찾지 못했습니다"));
    }

    #[test]
    fn websocket_must_be_loopback_and_match_the_requested_port() {
        assert!(local_websocket_matches_port(
            "ws://127.0.0.1:49152/devtools/page/1",
            49152
        ));
        assert!(!local_websocket_matches_port(
            "ws://127.0.0.1:9222/devtools/page/1",
            49152
        ));
        assert!(!local_websocket_matches_port(
            "ws://example.com:49152/devtools/page/1",
            49152
        ));
    }
}
