# Security

## Reporting a problem

If you find a security problem in Spelunker, please report it privately rather than in a public issue, so a fix can ship before the details are public. Use GitHub's private vulnerability reporting on this repository (the **Security** tab, then **Report a vulnerability**) if it is enabled, or open an issue that says only that you have a security report and how to reach you.

Please include the version (Settings > About has a button that copies it), what you did, and what happened.

## Supported versions

Fixes go into the latest release only. Update from the **Check for updates** button on the About tab or from the [releases page](https://github.com/TheEndless/spelunker/releases/latest).

## What Spelunker does and does not do

- Nothing about you or your files leaves your machine. The only network request is the update check, which asks one fixed GitHub address for the newest release number, and it can be turned off on the About tab.
- The page shown in the window is treated as untrusted by the Rust backend. Commands that take a path work only on files inside the folders of the current search, exports go through the native save dialog, and a custom editor command is not run until you approve it in a native dialog.
- The installers are not code-signed. Verify a download against the `SHA256SUMS.txt` file attached to the release before running it.

The [Security notes](README.md#security-notes) section of the README has the details.
