//! Which pages the main window may show. It only ever shows the app's own bundle, so any other
//! top-level navigation (for example from a previewed file's page) is refused. Without this, a
//! page in the preview frame could replace the app's page and call its commands.

use tauri::Url;

/// The address the dev server uses in development builds.
const DEV_SERVER_HOST: &str = "localhost";
const DEV_SERVER_PORT: u16 = 5173;

/// True for the app's own pages: its bundle (`tauri://localhost` or `http(s)://tauri.localhost`)
/// and, in development builds only, the Vite dev server.
pub fn is_app_page(url: &Url, development: bool) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (development
                    && url.scheme() == "http"
                    && url.host_str() == Some(DEV_SERVER_HOST)
                    && url.port() == Some(DEV_SERVER_PORT))
        }
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(address: &str, development: bool) -> bool {
        is_app_page(&Url::parse(address).unwrap(), development)
    }

    #[test]
    fn the_bundled_app_pages_are_allowed() {
        assert!(allowed("tauri://localhost/", false));
        assert!(allowed("http://tauri.localhost/", false));
        assert!(allowed("https://tauri.localhost/index.html", false));
    }

    #[test]
    fn the_dev_server_is_allowed_only_in_development() {
        assert!(allowed("http://localhost:5173/", true));
        assert!(!allowed("http://localhost:5173/", false));
    }

    #[test]
    fn another_port_on_localhost_is_refused() {
        assert!(!allowed("http://localhost:8080/", true));
    }

    #[test]
    fn a_previewed_file_served_by_the_asset_protocol_is_refused() {
        assert!(!allowed("http://asset.localhost/C%3A%5Cx%5Ca.pdf", false));
        assert!(!allowed("http://asset.localhost/C%3A%5Cx%5Ca.pdf", true));
    }

    #[test]
    fn the_web_and_local_files_are_refused() {
        assert!(!allowed("https://example.com/", false));
        assert!(!allowed("file:///C:/Users/me/a.html", false));
        assert!(!allowed("https://tauri.localhost.evil.example/", false));
    }

    #[test]
    fn a_blank_page_is_allowed() {
        assert!(allowed("about:blank", false));
        assert!(!allowed("about:srcdoc", false));
    }
}
