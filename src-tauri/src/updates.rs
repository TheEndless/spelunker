//! Looking for a newer release on GitHub, and opening its page.
//!
//! This is the one thing Spelunker asks the network for, and it is done here and not in the page:
//! the page may not reach the network at all (its Content Security Policy forbids it), and doing it
//! here means the address asked is fixed in the code, the answer is size limited and checked, and
//! the only address ever opened in the browser is a page of this project's releases.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::time::Duration;

/// The project's GitHub repository, as owner and name.
const REPOSITORY: &str = "TheEndless/spelunker";
/// Where the newest published (not draft, not pre-release) release is described.
const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/TheEndless/spelunker/releases/latest";
/// The page of releases, which is also where a release found points, when GitHub's own address is odd.
const RELEASES_PAGE: &str = "https://github.com/TheEndless/spelunker/releases";
/// Only addresses that start with this are ever opened.
const OPENABLE_PREFIX: &str = "https://github.com/TheEndless/spelunker/";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REDIRECTS: u32 = 3;
/// A release description is a few kilobytes. Anything past this is not one.
const MAX_RESPONSE_BYTES: u64 = 512 * 1024;

/// What a check found, in the shape the page uses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// The version of this app.
    pub current: String,
    /// The version of the newest release, as GitHub names it without a leading "v".
    pub latest: String,
    /// True when `latest` is newer than `current`.
    pub available: bool,
    /// The page of that release, which View release opens.
    pub page: String,
    /// When it was published, as GitHub writes it, when it says.
    pub published: Option<String>,
}

/// Why a check found nothing, in words a person can act on.
#[derive(Debug, PartialEq, Eq)]
pub enum UpdateError {
    /// GitHub has no release to show: none are published, or the project is not public yet.
    NoReleases,
    /// GitHub is asking to slow down.
    RateLimited,
    Server(u16),
    /// The network could not be reached, or the connection failed.
    Network(String),
    /// GitHub answered with something that is not a release description.
    BadAnswer(String),
}

impl fmt::Display for UpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UpdateError::NoReleases => write!(
                formatter,
                "No release has been published yet, or the project is not public yet."
            ),
            UpdateError::RateLimited => write!(
                formatter,
                "GitHub is asking for fewer requests. Try again in a little while."
            ),
            UpdateError::Server(code) => write!(
                formatter,
                "GitHub answered with an error ({code}). Try again later."
            ),
            UpdateError::Network(why) => write!(formatter, "Could not reach GitHub: {why}"),
            UpdateError::BadAnswer(why) => {
                write!(formatter, "GitHub's answer could not be read: {why}")
            }
        }
    }
}

/// A version as its numbers, or `None` when it is not a plain release number. A leading `v` is
/// allowed. A pre-release such as `1.2.0-rc1` is not a plain release, so it is never offered.
pub fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let trimmed = text.trim().trim_start_matches(['v', 'V']);
    let mut numbers = trimmed.split('.');
    let mut next = || numbers.next()?.parse::<u64>().ok();
    let version = (next()?, next()?, next()?);
    numbers.next().is_none().then_some(version)
}

/// Whether `latest` is a newer release than `current`. Either not being a plain release number
/// means no.
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

/// Whether an address is a page of this project, which is the only kind opened in the browser.
pub fn is_openable(address: &str) -> bool {
    address.starts_with(OPENABLE_PREFIX)
        && address.len() <= 300
        && !address.contains("..")
        && address.chars().all(|character| {
            character.is_ascii_graphic()
                && !matches!(
                    character,
                    '"' | '<' | '>' | '\\' | '^' | '`' | '{' | '}' | '|' | '%'
                )
        })
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// What a release description says about updating from `current`.
pub fn interpret(current: &str, body: &str) -> Result<UpdateInfo, UpdateError> {
    let release: Release =
        serde_json::from_str(body).map_err(|error| UpdateError::BadAnswer(error.to_string()))?;
    let latest = release
        .tag_name
        .trim()
        .trim_start_matches(['v', 'V'])
        .to_string();
    if parse_version(&latest).is_none() {
        return Err(UpdateError::BadAnswer(format!(
            "\"{}\" is not a version number",
            release.tag_name.chars().take(40).collect::<String>()
        )));
    }
    // GitHub's "latest" is never a draft or a pre-release, but the answer is not taken on trust.
    let available = !release.draft && !release.prerelease && is_newer(&latest, current);
    // Whatever page the answer names, only a page of this project is passed on.
    let page = release
        .html_url
        .filter(|address| is_openable(address))
        .unwrap_or_else(|| RELEASES_PAGE.to_string());
    Ok(UpdateInfo {
        current: current.to_string(),
        latest,
        available,
        page,
        published: release.published_at.filter(|date| date.len() <= 40),
    })
}

fn agent(require_https: bool) -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .timeout_global(Some(REQUEST_TIMEOUT))
        .max_redirects(MAX_REDIRECTS)
        .https_only(require_https)
        // A status other than 200 is read here, so each one can be told apart.
        .http_status_as_error(false)
        .build()
        .into()
}

/// Asks `url` for the release description and returns its text. `require_https` is only ever false
/// in the tests, which talk to a server on this computer.
fn fetch(url: &str, version: &str, require_https: bool) -> Result<String, UpdateError> {
    let mut response = agent(require_https)
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header(
            "User-Agent",
            &format!("Spelunker/{version} (+https://github.com/{REPOSITORY})"),
        )
        .call()
        .map_err(|error| UpdateError::Network(error.to_string()))?;
    match response.status().as_u16() {
        200 => {}
        404 => return Err(UpdateError::NoReleases),
        403 | 429 => return Err(UpdateError::RateLimited),
        code => return Err(UpdateError::Server(code)),
    }
    response
        .body_mut()
        .with_config()
        .limit(MAX_RESPONSE_BYTES)
        .read_to_string()
        .map_err(|error| UpdateError::Network(error.to_string()))
}

/// Looks for a newer release than `current` on GitHub.
pub fn check(current: &str) -> Result<UpdateInfo, UpdateError> {
    let (url, require_https) = (LATEST_RELEASE_API.to_string(), true);
    // A debug build can be pointed at a server on this computer, to try the banner without a release.
    #[cfg(debug_assertions)]
    let (url, require_https) = match std::env::var("SPELUNKER_UPDATE_URL") {
        Ok(address) => (address, false),
        Err(_) => (url, require_https),
    };
    outcome(current, fetch(&url, current, require_https))
}

/// What a fetch's result means for an app at `current`.
fn outcome(current: &str, fetched: Result<String, UpdateError>) -> Result<UpdateInfo, UpdateError> {
    match fetched {
        Ok(body) => interpret(current, &body),
        // No release is public, so there is nothing newer to offer. That is not a failure to report.
        Err(UpdateError::NoReleases) => Ok(UpdateInfo {
            current: current.to_string(),
            latest: current.to_string(),
            available: false,
            page: RELEASES_PAGE.to_string(),
            published: None,
        }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn a_plain_version_is_its_three_numbers() {
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("v1.10.0"), Some((1, 10, 0)));
        assert_eq!(parse_version(" V2.0.1 "), Some((2, 0, 1)));
    }

    #[test]
    fn anything_else_is_not_a_plain_version() {
        for text in [
            "",
            "1.2",
            "1.2.3.4",
            "1.2.x",
            "1.2.3-rc1",
            "1.2.3+build",
            "latest",
            "-1.0.0",
            "1..3",
        ] {
            assert_eq!(parse_version(text), None, "{text}");
        }
    }

    #[test]
    fn newer_means_a_higher_version_compared_number_by_number() {
        assert!(is_newer("1.2.0", "1.1.0"));
        assert!(
            is_newer("1.10.0", "1.9.0"),
            "10 is more than 9, as a number and not as text"
        );
        assert!(is_newer("2.0.0", "1.99.99"));
        assert!(is_newer("v1.1.1", "1.1.0"));
        assert!(!is_newer("1.1.0", "1.1.0"));
        assert!(!is_newer("1.0.9", "1.1.0"));
        assert!(
            !is_newer("1.2.0-rc1", "1.1.0"),
            "a pre-release is never offered"
        );
        assert!(!is_newer("nonsense", "1.1.0"));
        assert!(!is_newer("1.2.0", "development"));
    }

    #[test]
    fn only_pages_of_this_project_may_be_opened() {
        assert!(is_openable(
            "https://github.com/TheEndless/spelunker/releases/tag/v1.2.0"
        ));
        assert!(is_openable(RELEASES_PAGE));
        for address in [
            "http://github.com/TheEndless/spelunker/releases",
            "https://github.com/TheEndless/spelunker-evil/releases",
            "https://github.com/Other/spelunker/releases",
            "https://github.com.evil.example/TheEndless/spelunker/",
            "https://evil.example/https://github.com/TheEndless/spelunker/",
            "https://github.com/TheEndless/spelunker/../../evil",
            // A browser reads %2e%2e as a parent folder too, which would leave this project's pages.
            "https://github.com/TheEndless/spelunker/%2e%2e/%2E%2E/evil",
            "https://github.com/TheEndless/spelunker/releases \"calc.exe\"",
            "https://github.com/TheEndless/spelunker/releases\r\nX: y",
            "https://github.com/TheEndless/spelunker/releases|calc",
            "file:///C:/Windows/System32/calc.exe",
            "calc.exe",
            "",
        ] {
            assert!(!is_openable(address), "{address}");
        }
    }

    fn release(tag: &str, extra: &str) -> String {
        format!(
            r#"{{"tag_name":"{tag}","html_url":"https://github.com/TheEndless/spelunker/releases/tag/{tag}","published_at":"2026-11-01T10:00:00Z"{extra}}}"#
        )
    }

    #[test]
    fn a_newer_release_is_available() {
        let info = interpret("1.1.0", &release("v1.2.0", "")).unwrap();
        assert_eq!(
            info,
            UpdateInfo {
                current: "1.1.0".into(),
                latest: "1.2.0".into(),
                available: true,
                page: "https://github.com/TheEndless/spelunker/releases/tag/v1.2.0".into(),
                published: Some("2026-11-01T10:00:00Z".into()),
            }
        );
    }

    #[test]
    fn the_same_or_an_older_release_is_not_an_update() {
        assert!(
            !interpret("1.2.0", &release("v1.2.0", ""))
                .unwrap()
                .available
        );
        assert!(
            !interpret("1.3.0", &release("v1.2.0", ""))
                .unwrap()
                .available
        );
    }

    #[test]
    fn a_draft_or_a_pre_release_is_not_an_update_even_if_it_is_newer() {
        assert!(
            !interpret("1.1.0", &release("v1.2.0", r#","draft":true"#))
                .unwrap()
                .available
        );
        assert!(
            !interpret("1.1.0", &release("v1.2.0", r#","prerelease":true"#))
                .unwrap()
                .available
        );
    }

    #[test]
    fn a_page_that_is_not_this_project_is_replaced_by_the_releases_page() {
        let body = r#"{"tag_name":"v1.2.0","html_url":"https://evil.example/download.exe"}"#;
        assert_eq!(interpret("1.1.0", body).unwrap().page, RELEASES_PAGE);
        let missing = r#"{"tag_name":"v1.2.0"}"#;
        assert_eq!(interpret("1.1.0", missing).unwrap().page, RELEASES_PAGE);
    }

    #[test]
    fn an_answer_that_is_not_a_release_is_an_error_that_says_so() {
        for body in [
            "",
            "not json",
            "[]",
            r#"{"message":"Not Found"}"#,
            r#"{"tag_name":"soon"}"#,
            r#"{"tag_name":7}"#,
        ] {
            assert!(
                matches!(interpret("1.1.0", body), Err(UpdateError::BadAnswer(_))),
                "{body}"
            );
        }
    }

    /// Serves one answer to the next request on this computer, and returns the address to ask.
    fn serve_once(status_line: &'static str, body: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request);
                let answer = format!("HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        format!("http://{address}/releases/latest")
    }

    #[test]
    fn a_release_is_fetched_over_the_network_and_read() {
        let url = serve_once("200 OK", release("v1.2.0", ""));
        let body = fetch(&url, "1.1.0", false).unwrap();
        assert!(interpret("1.1.0", &body).unwrap().available);
    }

    #[test]
    fn each_kind_of_answer_has_its_own_error() {
        assert_eq!(
            fetch(&serve_once("404 Not Found", "{}".into()), "1.1.0", false),
            Err(UpdateError::NoReleases)
        );
        assert_eq!(
            fetch(&serve_once("403 Forbidden", "{}".into()), "1.1.0", false),
            Err(UpdateError::RateLimited)
        );
        assert_eq!(
            fetch(
                &serve_once("429 Too Many Requests", "{}".into()),
                "1.1.0",
                false
            ),
            Err(UpdateError::RateLimited)
        );
        assert_eq!(
            fetch(
                &serve_once("500 Internal Server Error", "{}".into()),
                "1.1.0",
                false
            ),
            Err(UpdateError::Server(500))
        );
    }

    #[test]
    fn an_answer_far_bigger_than_a_release_is_refused() {
        let url = serve_once("200 OK", "x".repeat(MAX_RESPONSE_BYTES as usize + 1000));
        assert!(matches!(
            fetch(&url, "1.1.0", false),
            Err(UpdateError::Network(_))
        ));
    }

    #[test]
    fn nothing_listening_is_a_network_error() {
        let address = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        assert!(matches!(
            fetch(&format!("http://{address}/"), "1.1.0", false),
            Err(UpdateError::Network(_))
        ));
    }

    /// Asks GitHub itself, so it needs the network and is left out of normal runs: cargo test -- --ignored.
    /// While the repository is private GitHub answers 404, which is reported as nothing newer. Once it
    /// is public and has a release, this finds that release. Either way the secure connection works.
    #[test]
    #[ignore = "asks GitHub over the network"]
    fn github_answers_over_a_secure_connection() {
        let info = check("0.0.1").expect("the check should get an answer");
        assert!(is_openable(&info.page), "{info:?}");
    }

    #[test]
    fn a_project_with_no_public_release_has_nothing_newer() {
        let info = outcome("1.1.0", Err(UpdateError::NoReleases)).expect("a 404 is not a failure");
        assert!(!info.available);
        assert_eq!(info.latest, "1.1.0");
        assert!(is_openable(&info.page));
        assert_eq!(
            outcome("1.1.0", Err(UpdateError::RateLimited)),
            Err(UpdateError::RateLimited)
        );
    }

    #[test]
    fn only_https_is_allowed_in_the_real_app() {
        let url = serve_once("200 OK", release("v1.2.0", ""));
        assert!(matches!(
            fetch(&url, "1.1.0", true),
            Err(UpdateError::Network(_))
        ));
    }
}
