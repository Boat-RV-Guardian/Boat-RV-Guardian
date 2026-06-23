use std::io::{Read, Write};
use std::net::{TcpStream, SocketAddr, IpAddr};
use std::time::Duration;
use std::collections::HashMap;
use tauri::command;
use axum::{routing::{post, get}, Router};
use axum::extract::{Query, State, ConnectInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Existing raw HTTP command (keep as-is — used for all LinkTap API calls)
// ---------------------------------------------------------------------------

#[command]
async fn raw_linktap_post(ip: String, payload: String) -> Result<String, String> {
    let addr: SocketAddr = format!("{}:80", ip).parse().map_err(|e| format!("Invalid IP: {}", e))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))
        .map_err(|e| format!("Failed to connect: {}", e))?;
    
    stream.set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;

    let request = format!(
        "POST /api.shtml HTTP/1.1\r\n\
         Host: {}\r\n\
         Connection: close\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         \r\n\
         {}",
        ip,
        payload.len(),
        payload
    );

    stream.write_all(request.as_bytes())
        .map_err(|e| format!("Failed to write: {}", e))?;

    let mut response = String::new();
    stream.read_to_string(&mut response)
        .map_err(|e| format!("Failed to read: {}", e))?;

    if let Some(body_start) = response.find("\r\n\r\n") {
        Ok(response[body_start + 4..].trim().to_string())
    } else if let Some(body_start) = response.find("\n\n") {
        Ok(response[body_start + 2..].trim().to_string())
    } else {
        Ok(response)
    }
}

// ---------------------------------------------------------------------------
// Gateway fingerprint probe — confirms a host is a LinkTap gateway.
// Uses raw TCP (same pattern as raw_linktap_post) for reliability with
// embedded HTTP servers that may not be fully HTTP/1.1 compliant.
// ---------------------------------------------------------------------------

async fn probe_linktap_api(ip: String) -> bool {
    let addr: SocketAddr = match format!("{}:80", ip).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };

    tokio::task::spawn_blocking(move || -> bool {
        let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));

        // Minimal probe — cmd:0 is a safe no-op on the LinkTap local API
        let payload = r#"{"cmd":0}"#;
        let request = format!(
            "POST /api.shtml HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            ip, payload.len(), payload
        );

        if stream.write_all(request.as_bytes()).is_err() {
            return false;
        }

        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);

        // LinkTap local API always responds with JSON containing "ret" or known fields
        response.contains("\"ret\"")
            || response.contains("\"result\"")
            || response.contains("taplinkerId")
            || response.contains("gw_id")
    })
    .await
    .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tier 1: mDNS Discovery
// Browses _http._tcp.local. for up to `timeout_secs` seconds.
// Filters candidates by instance name, validates with /api.shtml probe.
// ---------------------------------------------------------------------------

#[command]
async fn discover_via_mdns(timeout_secs: u64) -> Result<Vec<String>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let mdns = ServiceDaemon::new().map_err(|e| format!("mDNS daemon error: {}", e))?;
    let receiver = mdns
        .browse("_http._tcp.local.")
        .map_err(|e| format!("mDNS browse error: {}", e))?;

    let mut candidates: Vec<String> = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs.min(10));

    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let name = info.get_fullname().to_lowercase();
                // LinkTap gateway hostnames contain "linktap" or "gw-" prefix
                let looks_like_linktap = name.contains("linktap")
                    || name.contains("gw-0")
                    || name.contains("gw-1")
                    || name.contains("gw-2");

                if looks_like_linktap {
                    for addr in info.get_addresses() {
                        let ip = addr.to_string();
                        if !candidates.contains(&ip) {
                            candidates.push(ip);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let _ = mdns.shutdown();

    // Validate candidates with /api.shtml fingerprint to eliminate false positives
    let mut confirmed = Vec::new();
    for ip in candidates {
        if probe_linktap_api(ip.clone()).await {
            confirmed.push(ip);
        }
    }

    Ok(confirmed)
}

// ---------------------------------------------------------------------------
// Tier 2: HTTP Subnet Scan
// Concurrently probes all 254 hosts on the local /24 subnet.
// Any host responding to /api.shtml with a LinkTap signature is returned.
// ---------------------------------------------------------------------------

#[command]
async fn discover_via_subnet_scan() -> Result<Vec<String>, String> {
    let local_ip = local_ip_address::local_ip()
        .map_err(|e| format!("Could not determine local IP: {}", e))?;

    let octets = match local_ip {
        IpAddr::V4(v4) => v4.octets(),
        IpAddr::V6(_) => return Err("IPv6 networks not supported for subnet scan".into()),
    };

    let mut handles = Vec::new();

    for host in 1u8..=254 {
        let ip = format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], host);
        handles.push(tokio::spawn(async move {
            if probe_linktap_api(ip.clone()).await {
                Some(ip)
            } else {
                None
            }
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(Some(ip)) = handle.await {
            results.push(ip);
        }
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Combined: Run mDNS and subnet scan in parallel, merge results.
// Calling this is the recommended single entry-point from the frontend.
// ---------------------------------------------------------------------------

#[command]
async fn discover_gateway() -> Result<Vec<String>, String> {
    let (mdns_result, scan_result) = tokio::join!(
        discover_via_mdns(4),
        discover_via_subnet_scan()
    );

    let mut combined: Vec<String> = Vec::new();

    for result in [mdns_result, scan_result] {
        if let Ok(ips) = result {
            for ip in ips {
                if !combined.contains(&ip) {
                    combined.push(ip);
                }
            }
        }
    }

    Ok(combined)
}

// ---------------------------------------------------------------------------
// Webhook Server
// ---------------------------------------------------------------------------

async fn flood_webhook_handler(State(app_handle): State<AppHandle>) -> &'static str {
    let _ = app_handle.emit("flood-alarm", ());
    "OK"
}

// Generic local webhook for any Shelly event. Sleepy sensors fire this on wake (in addition to the
// cloud worker). We forward the query params AND the device's current source IP to the frontend so
// it can (a) react/notify instantly with no internet, and (b) "strike" Shelly.GetStatus back at the
// awake device to pull full telemetry, then refresh the device's webhooks to the current app IP.
async fn shelly_local_handler(
    State(app_handle): State<AppHandle>,
    Query(params): Query<HashMap<String, String>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> &'static str {
    let event = params.get("event").cloned().unwrap_or_default();
    let payload = serde_json::json!({
        "vid": params.get("vid").cloned().unwrap_or_default(),
        "device": params.get("device").cloned().unwrap_or_default(),
        "event": event,
        "ip": addr.ip().to_string(),
    });
    // Preserve the valve auto-close path: flood/leak events also fire the flood-alarm signal that
    // LinkTapWidget listens for (local registration now routes flood through /api/shelly).
    let ev = event.to_lowercase();
    if ev.contains("flood") || ev.contains("leak") || ev.contains("alarm") {
        let _ = app_handle.emit("flood-alarm", ());
    }
    log::info!("local shelly webhook: {}", payload);
    let _ = app_handle.emit("shelly-local-event", payload);
    "OK"
}

fn start_webhook_server(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let app = Router::new()
            .route("/api/webhook/flood", post(flood_webhook_handler))
            // Shelly webhooks issue GET requests; accept POST too for flexibility.
            .route("/api/shelly", get(shelly_local_handler).post(shelly_local_handler))
            .with_state(app_handle);

        let addr = std::net::SocketAddr::from(([0, 0, 0, 0], 3030));
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(_) => return,
        };
        // into_make_service_with_connect_info exposes the peer SocketAddr to handlers (source IP).
        let _ = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await;
    });
}

// The app's current LAN IP — used to build the local webhook URL registered on Shelly devices.
#[command]
fn get_local_ip() -> Result<String, String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| format!("Could not determine local IP: {}", e))
}

#[derive(Serialize)]
struct ShellyService {
    name: String,
    host: String,
    ips: Vec<String>,
}

// Browse mDNS for Shelly devices. Steady-state reads use the `.local` host so they survive DHCP
// IP churn; this discovery is for listing/initial mapping.
#[command]
async fn discover_shelly(timeout_secs: u64) -> Result<Vec<ShellyService>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};

    let mdns = ServiceDaemon::new().map_err(|e| format!("mDNS daemon error: {}", e))?;
    let receiver = mdns
        .browse("_shelly._tcp.local.")
        .map_err(|e| format!("mDNS browse error: {}", e))?;

    let mut out: Vec<ShellyService> = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs.min(10));

    while std::time::Instant::now() < deadline {
        if let Ok(ServiceEvent::ServiceResolved(info)) = receiver.recv_timeout(Duration::from_millis(200)) {
            let host = info.get_hostname().trim_end_matches('.').to_string();
            if out.iter().any(|s| s.host == host) {
                continue;
            }
            let ips: Vec<String> = info.get_addresses().iter().map(|a| a.to_string()).collect();
            out.push(ShellyService {
                name: info.get_fullname().to_string(),
                host,
                ips,
            });
        }
    }

    let _ = mdns.shutdown();
    Ok(out)
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            start_webhook_server(app_handle);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            raw_linktap_post,
            discover_gateway,
            discover_via_mdns,
            discover_via_subnet_scan,
            discover_shelly,
            get_local_ip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
