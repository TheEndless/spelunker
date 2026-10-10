mod common;

use common::{build_fixture, run, write_long_path_file};
use spelunker_core::{ContentQuery, SearchConfig};

fn all_files_config(root: &std::path::Path) -> SearchConfig {
    SearchConfig::new(vec![root.to_path_buf()])
}

#[test]
fn default_excludes_skip_git_node_modules_and_recycle_bin() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let outcome = run(&all_files_config(root.path()));
    let names = outcome.names();
    for skipped in ["config", "index.js", "trash.txt"] {
        assert!(
            !names.contains(&skipped.to_string()),
            "{skipped} should be excluded"
        );
    }
}

#[test]
fn exclude_list_is_configurable_and_case_insensitive() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let mut config = all_files_config(root.path());
    config.exclude_dirs = vec!["LOGS".to_string()];
    let outcome = run(&config);
    let names = outcome.names();
    assert!(!names.contains(&"app.log".to_string()));
    assert!(
        names.contains(&"index.js".to_string()),
        "defaults are replaced, not merged"
    );
}

#[test]
fn the_start_folder_itself_is_never_excluded() {
    let root = tempfile::tempdir().unwrap();
    let excluded_name = root.path().join("node_modules");
    common::write(&excluded_name, "a.txt", b"x");
    let outcome = run(&all_files_config(&excluded_name));
    assert_eq!(outcome.names(), vec!["a.txt"]);
}

#[test]
fn dotfiles_are_hidden_unless_requested() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    assert!(!run(&all_files_config(root.path()))
        .names()
        .contains(&".hidden.txt".to_string()));
    let mut config = all_files_config(root.path());
    config.include_hidden = true;
    assert!(run(&config).names().contains(&".hidden.txt".to_string()));
}

#[cfg(windows)]
#[test]
fn files_with_the_windows_hidden_attribute_are_hidden_unless_requested() {
    let root = tempfile::tempdir().unwrap();
    common::write(root.path(), "visible.txt", b"x");
    let hidden = common::write(root.path(), "attrib_hidden.txt", b"x");
    let status = std::process::Command::new("attrib")
        .arg("+H")
        .arg(&hidden)
        .status()
        .unwrap();
    assert!(status.success());

    assert_eq!(
        run(&all_files_config(root.path())).names(),
        vec!["visible.txt"]
    );
    let mut config = all_files_config(root.path());
    config.include_hidden = true;
    assert_eq!(
        run(&config).names(),
        vec!["attrib_hidden.txt", "visible.txt"]
    );
}

#[test]
fn subfolders_can_be_turned_off() {
    let root = tempfile::tempdir().unwrap();
    build_fixture(root.path());
    let mut config = all_files_config(root.path());
    config.recurse = false;
    assert_eq!(run(&config).names(), vec!["special.txt"]);
}

#[test]
fn depth_limit_counts_levels_below_the_start_folder() {
    let root = tempfile::tempdir().unwrap();
    common::write(root.path(), "top.txt", b"x");
    common::write(root.path(), "one/level1.txt", b"x");
    common::write(root.path(), "one/two/level2.txt", b"x");
    let mut config = all_files_config(root.path());
    config.max_depth = Some(1);
    assert_eq!(run(&config).names(), vec!["level1.txt", "top.txt"]);
}

#[test]
fn several_start_folders_are_all_searched() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    common::write(first.path(), "one.txt", b"x");
    common::write(second.path(), "two.txt", b"x");
    let config = SearchConfig::new(vec![
        first.path().to_path_buf(),
        second.path().to_path_buf(),
    ]);
    assert_eq!(run(&config).names(), vec!["one.txt", "two.txt"]);
}

#[test]
fn paths_longer_than_260_characters_are_found_by_name_and_content() {
    let root = tempfile::tempdir().unwrap();
    write_long_path_file(root.path(), "deep.txt", b"find the needle here\n");
    let mut config = all_files_config(root.path());
    config.content = Some(ContentQuery::literal("needle"));
    let outcome = run(&config);
    assert_eq!(outcome.names(), vec!["deep.txt"]);
    assert_eq!(outcome.file("deep.txt").hits.len(), 1);
    assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
}

#[cfg(windows)]
#[test]
fn symlinks_are_not_followed_by_default() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("target");
    common::write(&target, "inside.txt", b"x");
    let link = root.path().join("link");
    // Symlink creation needs privilege or developer mode, so skip quietly without it.
    if std::os::windows::fs::symlink_dir(&target, &link).is_err() {
        eprintln!("skipping: cannot create symlinks here");
        return;
    }
    let outcome = run(&all_files_config(root.path()));
    assert_eq!(outcome.names(), vec!["inside.txt"]);
}

#[cfg(windows)]
mod links_and_hidden_folders {
    use super::*;
    use common::{make_junction, set_attribute, write};
    use spelunker_core::CancelToken;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn junctions_are_not_followed_by_default() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "real/inside.txt", b"x");
        make_junction(&root.path().join("link"), &root.path().join("real"));
        let outcome = run(&all_files_config(root.path()));
        assert_eq!(outcome.names(), vec!["inside.txt"]);
        assert!(outcome.errors.is_empty());
    }

    #[test]
    fn following_junctions_finds_files_behind_them() {
        let root = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        write(elsewhere.path(), "deep/remote.txt", b"x");
        make_junction(&root.path().join("link"), elsewhere.path());

        assert!(run(&all_files_config(root.path())).files.is_empty());

        let mut config = all_files_config(root.path());
        config.follow_links = true;
        let outcome = run(&config);
        assert_eq!(outcome.names(), vec!["remote.txt"]);
        assert!(outcome.files[0].path.starts_with(root.path().join("link")));
    }

    #[test]
    fn a_junction_pointing_back_up_the_tree_does_not_loop_forever() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "a/inside.txt", b"x");
        make_junction(&root.path().join("a").join("back"), root.path());

        let mut config = all_files_config(root.path());
        config.follow_links = true;

        // A runaway walk must fail the test rather than hang the suite.
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(run(&config));
        });
        let outcome = receiver
            .recv_timeout(Duration::from_secs(30))
            .expect("search did not finish: the junction loop was followed");

        assert_eq!(outcome.names(), vec!["inside.txt"]);
        assert_eq!(outcome.errors.len(), 1, "the loop should be reported once");
        assert!(outcome.errors[0].path.ends_with("back"));
        assert!(outcome.errors[0].message.to_lowercase().contains("loop"));
        assert_eq!(outcome.summary.errors, 1);
    }

    #[test]
    fn two_junctions_pointing_at_each_other_terminate() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "one/one.txt", b"x");
        write(root.path(), "two/two.txt", b"x");
        make_junction(
            &root.path().join("one").join("to_two"),
            &root.path().join("two"),
        );
        make_junction(
            &root.path().join("two").join("to_one"),
            &root.path().join("one"),
        );

        let mut config = all_files_config(root.path());
        config.follow_links = true;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(run(&config));
        });
        let outcome = receiver
            .recv_timeout(Duration::from_secs(30))
            .expect("search did not finish: mutual junctions were followed forever");
        assert!(outcome.names().contains(&"one.txt".to_string()));
        assert!(outcome.names().contains(&"two.txt".to_string()));
    }

    #[test]
    fn a_cancelled_walk_through_links_still_returns() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "a/inside.txt", b"x");
        make_junction(&root.path().join("a").join("back"), root.path());
        let mut config = all_files_config(root.path());
        config.follow_links = true;
        let cancel = CancelToken::new();
        cancel.cancel();
        assert!(common::run_with_cancel(&config, &cancel).summary.cancelled);
    }

    #[test]
    fn hidden_folders_are_skipped_with_everything_inside_unless_requested() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "visible/seen.txt", b"x");
        let hidden_files = write(root.path(), "hidden_dir/inner/unseen.txt", b"x");
        set_attribute(&root.path().join("hidden_dir"), "+H");
        assert!(hidden_files.exists());

        assert_eq!(
            run(&all_files_config(root.path())).names(),
            vec!["seen.txt"]
        );

        let mut config = all_files_config(root.path());
        config.include_hidden = true;
        assert_eq!(run(&config).names(), vec!["seen.txt", "unseen.txt"]);
    }

    #[test]
    fn system_folders_are_skipped_unless_hidden_items_are_requested() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "visible/seen.txt", b"x");
        write(root.path(), "sys_dir/unseen.txt", b"x");
        set_attribute(&root.path().join("sys_dir"), "+S");

        assert_eq!(
            run(&all_files_config(root.path())).names(),
            vec!["seen.txt"]
        );

        let mut config = all_files_config(root.path());
        config.include_hidden = true;
        assert_eq!(run(&config).names(), vec!["seen.txt", "unseen.txt"]);
    }
}
