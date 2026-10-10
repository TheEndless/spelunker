//! Command-line harness over spelunker-core. Streams results as they are found.

use clap::Parser;
use spelunker_core::{
    search, CancelToken, ContentQuery, SearchConfig, SearchEvent, SizeRange, DEFAULT_EXCLUDED_DIRS,
};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "spelunker-cli", about = "Search file names and contents")]
struct Args {
    /// Folders to search (repeatable)
    #[arg(short = 'l', long = "look-in", required = true)]
    look_in: Vec<PathBuf>,

    /// File name wildcards, e.g. "*.log; *.txt; -*.min.js"
    #[arg(short, long, default_value = "")]
    name: String,

    /// Text to find inside files
    #[arg(short, long)]
    text: Option<String>,

    /// Match case
    #[arg(short = 'c', long)]
    match_case: bool,

    /// Whole word only
    #[arg(short, long)]
    word: bool,

    /// Treat the text as a regex
    #[arg(short, long)]
    regex: bool,

    /// Let a regex match across line breaks
    #[arg(long)]
    multi_line: bool,

    /// Treat --name as a regex on the file name instead of wildcards
    #[arg(long)]
    name_regex: bool,

    /// Smallest file size in bytes (inclusive)
    #[arg(long)]
    min_size: Option<u64>,

    /// Largest file size in bytes (inclusive)
    #[arg(long)]
    max_size: Option<u64>,

    /// Do not descend into subfolders
    #[arg(long)]
    no_subfolders: bool,

    /// Maximum folder levels below each start folder
    #[arg(long)]
    max_depth: Option<usize>,

    /// Folder names to skip (repeatable). Replaces the defaults
    #[arg(short = 'x', long = "exclude-dir")]
    exclude_dir: Vec<String>,

    /// Include hidden files and folders
    #[arg(long)]
    hidden: bool,

    /// Search binary files too
    #[arg(long)]
    binary: bool,

    /// Follow junctions and symlinked folders (loops are detected)
    #[arg(long)]
    follow_links: bool,
}

fn main() -> ExitCode {
    let args = Args::parse();

    let mut config = SearchConfig::new(args.look_in);
    if args.name_regex {
        config.name_regex = Some(args.name);
    } else {
        config.name_patterns = args.name;
    }
    config.size = SizeRange {
        min: args.min_size,
        max: args.max_size,
    };
    config.content = args.text.map(|text| ContentQuery {
        text,
        match_case: args.match_case,
        whole_word: args.word,
        regex: args.regex,
        multi_line: args.multi_line,
    });
    config.recurse = !args.no_subfolders;
    config.max_depth = args.max_depth;
    config.exclude_dirs = if args.exclude_dir.is_empty() {
        DEFAULT_EXCLUDED_DIRS
            .iter()
            .map(|name| name.to_string())
            .collect()
    } else {
        args.exclude_dir
    };
    config.include_hidden = args.hidden;
    config.include_binary = args.binary;
    config.follow_links = args.follow_links;

    let cancel = CancelToken::new();
    let handler_token = cancel.clone();
    if let Err(error) = ctrlc::set_handler(move || handler_token.cancel()) {
        eprintln!("warning: Ctrl+C will not cancel cleanly: {error}");
    }

    let outcome = search(&config, &cancel, |event| match event {
        // One print per event keeps a file's lines together when workers report at the same time.
        SearchEvent::File(file) => {
            let mut block = format!("{} ({} hits)\n", file.path.display(), file.hits.len());
            for hit in &file.hits {
                block.push_str(&format!("  {}: {}\n", hit.line_number, hit.line));
            }
            print!("{block}");
        }
        SearchEvent::Progress { .. } => {}
        SearchEvent::Error(error) => {
            eprintln!("error: {}: {}", error.path.display(), error.message)
        }
    });

    match outcome {
        Ok(summary) => {
            eprintln!(
                "{} files scanned, {} matched, {} hits, {} errors, {} binary skipped, {:.2?}{}",
                summary.files_scanned,
                summary.files_matched,
                summary.total_hits,
                summary.errors,
                summary.binary_skipped,
                summary.elapsed,
                if summary.cancelled {
                    " (cancelled)"
                } else {
                    ""
                },
            );
            if summary.cancelled {
                ExitCode::from(130)
            } else {
                ExitCode::SUCCESS
            }
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::from(2)
        }
    }
}
