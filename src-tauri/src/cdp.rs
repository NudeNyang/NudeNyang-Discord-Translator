use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tungstenite::{client, Message, WebSocket};
use url::Url;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CdpTarget {
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
        .filter(|target| !target.websocket_url.is_empty())
        .collect())
}

pub fn discord_target(port: u16) -> Result<CdpTarget, String> {
    select_discord_target(list_targets(port)?)
}

fn select_discord_target(targets: Vec<CdpTarget>) -> Result<CdpTarget, String> {
    if let Some(target) = targets
        .iter()
        .find(|target| target.url.starts_with("https://discord.com/channels/"))
    {
        return Ok(target.clone());
    }
    if let Some(target) = targets.iter().find(|target| {
        target.url.starts_with("https://discord.com/") && !target.url.contains("/popout")
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

pub struct CdpClient {
    websocket_url: String,
    timeout: Duration,
    next_id: u64,
    socket: Option<WebSocket<TcpStream>>,
}

impl CdpClient {
    pub fn new(websocket_url: impl Into<String>) -> Self {
        Self {
            websocket_url: websocket_url.into(),
            timeout: Duration::from_secs(10),
            next_id: 0,
            socket: None,
        }
    }

    pub fn connect(&mut self) -> Result<(), String> {
        if self.socket.is_some() {
            return Ok(());
        }
        let url = Url::parse(&self.websocket_url)
            .map_err(|error| format!("CDP WebSocket 주소가 올바르지 않아: {error}"))?;
        if url.scheme() != "ws" {
            return Err("로컬 Discord CDP는 ws:// 주소여야 해.".to_string());
        }
        let host = url
            .host_str()
            .ok_or_else(|| "CDP WebSocket 호스트가 없습니다.".to_string())?;
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
        let (socket, _) = client(self.websocket_url.as_str(), stream)
            .map_err(|error| format!("Discord CDP WebSocket 연결에 실패했습니다: {error}"))?;
        self.socket = Some(socket);
        Ok(())
    }

    pub fn close(&mut self) {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close(None);
        }
    }

    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.connect()?;
        self.next_id += 1;
        let request_id = self.next_id;
        let payload = json!({
            "id": request_id,
            "method": method,
            "params": params,
        });
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
                .map_err(|error| format!("CDP {method} 응답 형식이 잘못됐어: {error}"))?;
            if response.get("id").and_then(Value::as_u64) != Some(request_id) {
                continue;
            }
            if let Some(error) = response.get("error") {
                return Err(format!("CDP {method} 실패: {error}"));
            }
            return Ok(response.get("result").cloned().unwrap_or(Value::Null));
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

fn first_address(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("CDP WebSocket 주소를 해석하지 못했습니다: {error}"))?
        .next()
        .ok_or_else(|| "CDP WebSocket 주소를 찾지 못했습니다.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{discord_target, select_discord_target, CdpClient, CdpTarget};

    fn target(title: &str, url: &str) -> CdpTarget {
        CdpTarget {
            title: title.to_string(),
            url: url.to_string(),
            websocket_url: "ws://127.0.0.1/devtools/page/1".to_string(),
        }
    }

    #[test]
    fn channel_renderer_is_preferred_over_popouts_and_other_pages() {
        let selected = select_discord_target(vec![
            target("popout", "https://discord.com/popout/call"),
            target("home", "https://discord.com/app"),
            target("channel", "https://discord.com/channels/1/2"),
        ])
        .unwrap();
        assert_eq!(selected.title, "channel");
    }

    #[test]
    fn regular_discord_page_is_the_fallback() {
        let selected =
            select_discord_target(vec![target("home", "https://discord.com/app")]).unwrap();
        assert_eq!(selected.title, "home");
    }

    #[test]
    fn missing_discord_renderer_reports_available_targets() {
        let error =
            select_discord_target(vec![target("settings", "devtools://devtools")]).unwrap_err();
        assert!(error.contains("settings"));
    }

    #[test]
    #[ignore = "실행 중인 Discord 디버그 렌더러가 필요해"]
    fn live_discord_runtime_evaluates_javascript() {
        let target = discord_target(9222).expect("Discord channel target");
        let mut client = CdpClient::new(target.websocket_url);
        let title = client
            .evaluate("document.title", false)
            .expect("Runtime.evaluate");
        assert!(title.as_str().is_some_and(|title| !title.is_empty()));
    }
}
