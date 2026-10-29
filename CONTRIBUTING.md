# Contributing to Spelunker

Thanks for helping. Changes come in through issues and pull requests. Nobody but the maintainer pushes to `main`.

## Before you start

- **Bugs and ideas:** open an issue first. The templates ask for what is needed to reproduce a bug (the search, the folder, and the text from Settings > About > Copy version info).
- **Larger changes:** describe the change in an issue and wait for a reply before writing code, so the work is not wasted.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Sending a pull request

1. Fork the repo and create a branch from `main`.
2. Make one focused change per pull request.
3. Write the tests first, and see them fail before the code that fixes them. Rust tests build their files in a temporary folder, and frontend logic is tested with vitest, in a `.test.ts` file beside the code.
4. Run the checks that apply and make sure they pass:

```bash
cargo test
cargo clippy --workspace --all-targets
npm test
npm run check
```

5. Open the pull request and say what changed and why. Commit messages use an imperative subject line, with a body that explains why.

`npm run dev` shows the interface in a browser with a mock backend, which is the quickest way to try a visual change. `npm run tauri dev` runs the real app.

## Ground rules

- **The interface never touches the disk.** All file access lives in `crates/spelunker-core`.
- **Write the code yourself.** Spelunker is built from first-hand experience of what a file search should do. Do not submit code, icons, wording or screenshots taken from other file-search products, and do not describe a feature as "like" another product's. Describe the behavior you want instead.
- **Dependencies:** a new one needs a reason and a license that allows this project's use.
- **License:** by contributing you agree your work is released under the [MIT license](LICENSE).
