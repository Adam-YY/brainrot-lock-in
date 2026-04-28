# Tung Tung Lock-In

A VS Code extension that helps you stay focused in a coding session.

When a session is active and you switch away from VS Code for longer than the grace period, the extension launches a native Windows reminder window with:

- A random `assets/*.mp4` video
- Looping `assets/tung-tung-sahur.mp3`
- A full-screen always-on-top warning window

After you dismiss the warning, the distraction counter increases by 1. At session end, a modal summary displays the total.

## Running the extension
After installing the extension, go to your designated vs code window and do the following:
1. Open command palette by pressing ctrl + shift + P
2. type in "Tung Tung Lock-In: Start Session"
3. Select your lock in session length, and have fun coding!

To end the session, follow the same procedures but type in "Tung Tung Lock-In: Stop Session" instead

## Features

- Start a lock-in timer in minutes
- Focus-loss detection via VS Code window focus events
- Configurable grace period before counting a distraction
- Random warning video selection from bundled assets
- End-of-session modal report

## Commands

- `Tung Tung Lock-In: Start Session` (`tungTungLockIn.startSession`)
- `Tung Tung Lock-In: Stop Session` (`tungTungLockIn.stopSession`)

## Settings

- `tungTungLockIn.defaultSessionMinutes` (number, default: `25`)
- `tungTungLockIn.focusGraceSeconds` (number, default: `2`)

## Development

```bash
npm install
npm run compile
npm test
```

## Package As VSIX

```bash
npm install
npm run package:vsix
```

This creates `tung-tung-lock-in.vsix` in the project root.
