# Using Relayune

[Project home](../README.en.md) · [简体中文](getting-started.md)

The normal workflow is: **install on your computer → sign in and prepare an
Agent → connect your phone or browser → continue a task**.

## 1. Install the clients

Visit the [official website](https://relayune.giraffetree.cn) for current download
links. macOS and Android 0.3.33 downloads and Chinese/English release notes are published;
iOS availability remains subject to the unverified TestFlight status below.

| Device | Current installation path |
| --- | --- |
| Mac, macOS 13+ | Download the DMG and move Relayune to Applications. |
| Android | Download the APK from the official website and follow the system installation prompts. |
| iPhone / iPad | Use the Web client in Safari, or the TestFlight link when available. The initial native release will use public TestFlight testing before a later App Store release. |
| Browser | Open the website and connect to the computer running Relayune. |
| Windows | Build from source using the [Windows development guide](windows-desktop-development.md); no initial public installer is planned. |

Your computer must also run Relayune. A phone client alone cannot run the Agents
installed on your computer.

## 2. Sign in and prepare an Agent

1. On your Mac, open Relayune and choose **Sign in to Relayune**.
2. Sign in using your email and password in the browser. New accounts first use
   the verification email to set a password and confirm the computer login.
3. Return to Relayune and grant access to the folders containing your projects.
4. Prepare at least one of Codex, Claude Code or Kimi Code. Use the Agent panel
   to check installation and sign-in status.
5. Choose a default Agent and working directory if needed.

Your Relayune account connects devices. Each Agent still requires its own account
and model access. The Windows source build uses a different initial short-code
connection flow; see the Desktop documentation.

## 3. Connect a phone or browser

1. On the computer, choose **Connect device**, select the phone/tablet or browser
   option, and keep the eight-character code visible.
2. Sign in to the same Relayune account on the phone or browser.
3. In the mobile app, scan the QR code or enter the code manually. In the Web
   client, follow the pairing instructions and enter the code.
4. Wait until the computer appears connected and the workbench opens.

Each client receives an independent authorization. Pair new devices and browsers
separately. Generate a new code if it expires, and never publish pairing codes or
QR codes in screenshots.

## 4. Continue a task

- Select an online computer, project and session to view history and new output.
- Create a session where supported, choose a working directory and send a task.
- Review commands and other requested actions before approving or rejecting them.
- Use the stop action to interrupt a task. Prioritize foreground use; background
  notification delivery depends on platform and provider setup and is not guaranteed.

Keep the computer online, awake and running Relayune. Closing the window may
leave the tray or menu bar process running; quitting the application or putting
the computer to sleep prevents new local work. Cached history may remain readable.
Devices do not need to share Wi-Fi when both can reach the same Relayune service.

## 5. Manage access and troubleshoot

Revoke an individual phone or browser from the computer's **Manage devices** list.
Other clients keep their own authorizations. Sign out from the Desktop client to
end its account session.

For connection failures, check whether the computer is awake, Relayune is running,
and the selected Agent is signed in. For file access failures, check the working
directory and folder permissions. Use **Help and diagnostics** for connection status.
