# Welcome Extension

Provides a session-start welcome message and system information overlay for the pi-fleet environment.

## Overview

The `welcome` extension is responsible for displaying initial fleet status and system information when a session starts. It ensures the operator is aware of the current environment and any pending updates.

## Features

- **Welcome Header**: A concise status bar at the top of the session.
- **Welcome Overlay**: A detailed full-screen information panel.
- **Git Remote Update Detection**: 
  - Automatically checks if the current branch is synchronized with its remote tracking branch.
  - Displays a high-visibility alert banner when the local branch is behind the remote.
  - Shows "Up to date" status in the information panel when synchronized.
  - Helps operators stay in sync with the upstream repository.
- **Display Sanitization**:
  - Sanitizes display-only strings (branch names, versions) by removing C0, DEL, and C1 control characters (0x00-0x1F, 0x7F, 0x80-0x9F) to prevent terminal injection.
- **Fleet Update Command**:
  - Registers `/fleet:update` to ask the active PI agent to update the local `pi-fleet` checkout.
  - The command sends an AI-facing English prompt that includes the repository absolute path, remote branch synchronization, and `SETUP.md`-based update steps.

## Components

- `welcome.ts`: Core logic for status checking, rendering (including the update banner), and information building.
- `register.ts`: Extension registration and integration with the HUD.
- `types.ts`: Shared data structures.

## Fleet Update Command

Use `/fleet:update` when the operator wants PI to update this `pi-fleet` checkout through the normal agent workflow. The command computes the repository root from the loaded welcome extension location, then sends a user message instructing PI to move to that absolute path, synchronize the active branch with the remote latest state, and follow `SETUP.md` for dependency installation, build, and verification steps.

## Git Update Status Logic

The extension executes internal git commands to determine synchronization status:
- `git rev-parse --abbrev-ref HEAD`: To identify the current local branch.
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}`: To identify the tracking branch.
- `git rev-list --count HEAD..@{u}`: To count commits behind when an upstream exists.

### Visual Representation

The display layout adapts based on terminal width (minimum 44 chars) and the relationship with the remote tracking branch.

#### 1. Full-width Update Alert Banner
Displayed at the top of the welcome section when an update is available.
- **Condition**: `hasRemote === true && behind > 0`
- **Style**: Double-line border (`╔═╗║╚╝`), bright red (`alert`), bold.
- **Layout**: Centered vertically with the welcome box.
- **Content**:
  - Row 1: `⚠  UPDATE AVAILABLE  ⚠`
  - Row 2: `N commits behind origin/{branch}`
  - Row 3: `Current v{version} · Run /fleet:update to sync` (if version is available)

#### 2. Welcome Information Panel (Right Column)
Shows status when no update alert is active or for local-only branches.

- **Up to date**:
  - **Condition**: `hasRemote && behind === 0`
  - **Label**: `✓ Up to date ({branch}) · v{version}`
  - **Color**: `#A8D08D` (`gitClean` green)

- **Local branch**:
  - **Condition**: `isGitRepo && branch && !hasRemote`
  - **Label**: `● Local branch ({branch}) · v{version}`
  - **Color**: `#FEBC38` (`accent` yellow)

- **Not a git repository**:
  - **Condition**: `!isGitRepo`
  - **Action**: No status is displayed.

### Display Sanitization
All variable git strings (branch names, versions) are passed through a `sanitizeDisplay` helper before rendering. This removes potential ANSI escape sequences or control characters that could leak from external sources into the terminal UI.
