# Welcome Extension

Provides a session-start welcome message and system information overlay for the pi-fleet environment.

## Overview

The `welcome` extension is responsible for displaying initial fleet status and system information when a session starts. It ensures the operator is aware of the current environment and any pending updates.

## Features

- **Welcome Header**: A concise status bar at the top of the session.
- **Welcome Overlay**: A detailed full-screen information panel.
- **Git Remote Update Detection**: 
  - Automatically checks if the current branch is synchronized with its remote tracking branch.
  - Displays status regardless of whether it is outdated or up to date.
  - Helps operators stay in sync with the upstream repository.
- **Fleet Update Command**:
  - Registers `/fleet:update` to ask the active PI agent to update the local `pi-fleet` checkout.
  - The command sends an AI-facing English prompt that includes the repository absolute path, remote branch synchronization, and `SETUP.md`-based update steps.

## Components

- `welcome.ts`: Core logic for status checking and information building.
- `register.ts`: Extension registration and integration with the HUD.
- `types.ts`: Shared data structures.

## Fleet Update Command

Use `/fleet:update` when the operator wants PI to update this `pi-fleet` checkout through the normal agent workflow. The command computes the repository root from the loaded welcome extension location, then sends a user message instructing PI to move to that absolute path, synchronize the active branch with the remote latest state, and follow `SETUP.md` for dependency installation, build, and verification steps.

## Git Update Status Logic

The extension executes internal git commands to determine synchronization status:
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}`: To identify the tracking branch.
- `git rev-list --count HEAD..origin/branch`: To count commits behind.

### Visual Representation
The display depends on the relationship with the remote tracking branch:

- **Up to date**:
  - **Condition**: `hasRemote && behind === 0`
  - **Label**: `✓ Up to date (branch)`
  - **Color**: `#A8D08D` (`gitClean` green)

- **Update available**:
  - **Condition**: `hasRemote && behind > 0`
  - **Label**: `⚠ Update available`
  - **Details**: `N commits behind origin/branch`
  - **Color**: `#FFB347` (`warn` orange)

- **No Remote**:
  - **Condition**: `!hasRemote`
  - **Action**: No status is displayed.
