use crate::model::ConfigError;
use regex::{RegexSet, RegexSetBuilder};

/// Parsed form of `*.log; *.txt; -*.min.js`.
pub struct NameFilter {
    includes: Option<RegexSet>,
    excludes: Option<RegexSet>,
}

impl NameFilter {
    /// A non-empty `regex` replaces the wildcard `patterns` entirely.
    pub fn new(patterns: &str, regex: Option<&str>) -> Result<Self, ConfigError> {
        match regex.filter(|pattern| !pattern.is_empty()) {
            Some(pattern) => Ok(Self {
                includes: build_set(&[pattern.to_string()], false)?,
                excludes: None,
            }),
            None => Self::parse(patterns),
        }
    }

    pub fn parse(patterns: &str) -> Result<Self, ConfigError> {
        let mut includes = Vec::new();
        let mut excludes = Vec::new();
        for raw in patterns.split([';', ',']) {
            let pattern = raw.trim();
            let (target, wildcard) = match pattern.strip_prefix('-') {
                Some(rest) => (&mut excludes, rest.trim()),
                None => (&mut includes, pattern),
            };
            if !wildcard.is_empty() {
                target.push(wildcard_to_regex(wildcard));
            }
        }
        Ok(Self {
            includes: build_set(&includes, true)?,
            excludes: build_set(&excludes, true)?,
        })
    }

    pub fn is_match(&self, file_name: &str) -> bool {
        let included = self
            .includes
            .as_ref()
            .is_none_or(|set| set.is_match(file_name));
        included
            && !self
                .excludes
                .as_ref()
                .is_some_and(|set| set.is_match(file_name))
    }
}

/// Wildcard patterns let `.` cross newlines so odd file names still match. User regexes keep
/// the regex crate's normal behaviour.
fn build_set(patterns: &[String], wildcards: bool) -> Result<Option<RegexSet>, ConfigError> {
    if patterns.is_empty() {
        return Ok(None);
    }
    RegexSetBuilder::new(patterns)
        .case_insensitive(true)
        .dot_matches_new_line(wildcards)
        .build()
        .map(Some)
        .map_err(|error| ConfigError::InvalidNamePattern(error.to_string()))
}

/// Checks a name regex without running a search. Empty is valid and means "no regex".
pub fn validate_name_regex(pattern: &str) -> Result<(), ConfigError> {
    if pattern.is_empty() {
        return Ok(());
    }
    build_set(&[pattern.to_string()], false).map(|_| ())
}

/// A word with no wildcard matches anywhere in the name, so `report` behaves as `*report*`.
fn wildcard_to_regex(wildcard: &str) -> String {
    let has_wildcard = wildcard.contains(['*', '?']);
    let mut regex = String::from("^");
    if !has_wildcard {
        regex.push_str(".*");
    }
    for character in wildcard.chars() {
        match character {
            '*' => regex.push_str(".*"),
            '?' => regex.push('.'),
            other => regex.push_str(&regex::escape(&other.to_string())),
        }
    }
    if !has_wildcard {
        regex.push_str(".*");
    }
    regex.push('$');
    regex
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_word_is_wrapped_in_stars() {
        assert_eq!(wildcard_to_regex("report"), "^.*report.*$");
    }

    #[test]
    fn wildcards_become_regex_and_other_characters_are_escaped() {
        assert_eq!(wildcard_to_regex("a?.l*g"), r"^a.\.l.*g$");
    }

    #[test]
    fn names_with_newlines_still_match_dot_wildcards() {
        let filter = NameFilter::parse("a*b").unwrap();
        assert!(filter.is_match("a\nb"));
    }
}
