# fleet/bridge

Bridge UI/runtime modules for the Agent Panel, Streaming Widget, renderers, and ACP shell integration.

## Responsibility Split

- `panel/`: Agent Panel state, PanelJob lifecycle, focus/detail/keybind behavior, widget sync.
- `streaming/`: UI-only stream-store for visible runs and compact/widget data sources.
- `render/`: Pure rendering helpers for panel blocks, compact widget text, and ANSI formatting.
- `acp-shell/`: Active carrier shell overlay and bridge-session controls.
- `carrier-ui/`: Status Overlay and carrier-focused control surfaces.

## PanelJob Invariants

- **PanelJob is the SSOT for panel-visible detached work**: squadron/taskforce/sortie live streaming must enter the Agent Panel through `PanelJob` + `ColumnTrack`, not through Messages renderers.
- **Agent Panel is the only live streaming channel**: `renderCall` in Messages must stay a 1-line summary for shipyard tools.
- **ColumnTrack maps to exactly one visible run**: `streamKey` identifies the stream-store run that feeds one panel column/detail view.
- **Panel columns are job-scoped**: every active job is rendered as its own panel column. Do not add a job bar or job-switching shortcuts; compact widgets may still summarize active jobs.
- **UI-only boundary**: bridge panel state must not mutate shipyard execution doctrine, `JobStreamArchive`, or ACP executor contracts.
