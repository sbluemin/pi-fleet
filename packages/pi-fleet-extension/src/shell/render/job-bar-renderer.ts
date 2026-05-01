/**
 * fleet — Job Bar 렌더러
 *
 * Editor 하단(belowEditor)에 활성 PanelJob을 타일 형태로 렌더링합니다.
 * 가상 포커스 모드에서 ←→로 탐색하고 Enter로 확장합니다.
 * 확장 시 해당 job의 위치에서 바로 아래로 펼쳐집니다.
 */

import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
	ANSI_RESET,
	PANEL_DIM_COLOR,
	PANEL_RGB,
	SPINNER_FRAMES,
	SYM_INDICATOR,
	CLI_DISPLAY_NAMES,
} from "@sbluemin/fleet-core/constants";
import {
	buildPanelViewModel,
	getActiveJobs,
} from "@sbluemin/fleet-core/admiral/bridge/carrier-panel";
import type { PanelJobViewModel, PanelTrackViewModel } from "@sbluemin/fleet-core/admiral/bridge/carrier-panel";
import { resolveCarrierColor, resolveCarrierRgb } from "../../tool-registry.js";
import { getState } from "../../agent/ui/panel/state.js";
import { blockLineToAnsi, renderBlockLines } from "./block-renderer.js";
import { waveText } from "./panel-renderer.js";

// ─── 상수 ────────────────────────────────────────────────

const MAX_EXPANDED_STREAM_LINES = 5;
const MAX_EXPANDED_TOTAL_LINES = 8;
const TILE_SEPARATOR = ` ${PANEL_DIM_COLOR}│${ANSI_RESET} `;
const SEPARATOR_VIS_W = 3;
const COLOR_DONE = "\x1b[38;2;80;200;120m";
const COLOR_ERROR = "\x1b[38;2;255;80;80m";
const COLOR_ACTIVE = "\x1b[38;2;100;180;255m";
const STREAM_PREFIX = "  ";

const KIND_LABELS: Record<string, string> = {
	sortie: "Sortie",
	squadron: "Squadron",
	taskforce: "Taskforce",
};

// ─── 메인 진입점 ─────────────────────────────────────────

export function renderJobBar(width: number, frame: number): string[] {
	const jobs = getActiveJobs();
	if (jobs.length === 0) return [];

	const s = getState();
	const vmJobs = buildPanelViewModel(jobs, { maxTrackBlocks: MAX_EXPANDED_STREAM_LINES });
	const cursor = Math.min(s.jobBarCursor, vmJobs.length - 1);

	if (s.jobBarExpandedJobId && vmJobs.some((j) => j.jobId === s.jobBarExpandedJobId)) {
		return renderJobBarExpanded(width, vmJobs, cursor, s.jobBarExpandedJobId, frame);
	}

	return renderJobBarStrip(width, vmJobs, cursor, frame);
}

// ─── 축소 모드 (1줄) ─────────────────────────────────────

function renderJobBarStrip(
	width: number,
	jobs: PanelJobViewModel[],
	cursor: number,
	frame: number,
): string[] {
	const tiles = jobs.map((job, i) => formatJobTile(job, i === cursor, frame));
	const line = tiles.join(TILE_SEPARATOR);
	return [truncateToWidth(line, width)];
}

// ─── 확장 모드 ────────────────────────────────────────────

function renderJobBarExpanded(
	width: number,
	jobs: PanelJobViewModel[],
	cursor: number,
	expandedJobId: string,
	frame: number,
): string[] {
	const expandedIdx = jobs.findIndex((j) => j.jobId === expandedJobId);
	if (expandedIdx < 0) return renderJobBarStrip(width, jobs, cursor, frame);

	const expandedJob = jobs[expandedIdx];
	if (!expandedJob) return [];

	// 모든 타일 가로 나열 → 각 타일의 시작 offset 계산
	const tiles = jobs.map((job, i) => formatJobTile(job, i === cursor, frame));
	const offsets = computeTileOffsets(tiles);

	// 첫 줄: 전체 타일
	const lines: string[] = [truncateToWidth(tiles.join(TILE_SEPARATOR), width)];

	// 확장된 job 위치에서 들여쓰기
	const expandedOffset = offsets[expandedIdx] ?? 0;
	const indent = " ".repeat(expandedOffset);

	// 스쿼드론/태스크포스는 트랙 수와 관계없이 트리 형태로 렌더링
	if (expandedJob.kind === "squadron" || expandedJob.kind === "taskforce") {
		appendTrackTree(lines, width, expandedJob, indent, frame);
	} else {
		appendSingleTrackStream(lines, width, expandedJob, indent);
	}

	return lines.map((line) => truncateToWidth(line, width));
}

// ─── 멀티 트랙 트리 렌더링 ──────────────────────────────

function appendTrackTree(
	lines: string[],
	width: number,
	job: PanelJobViewModel,
	indent: string,
	frame: number,
): void {
	const budget = MAX_EXPANDED_TOTAL_LINES - 1; // 첫 줄(tile) 제외
	const fallbackColor = resolveCarrierColor(job.ownerCarrierId);
	let remaining = budget;

	for (let i = 0; i < job.tracks.length && remaining > 0; i++) {
		const track = job.tracks[i];
		if (!track) continue;
		const isLast = i === job.tracks.length - 1;
		const branch = isLast ? "└─" : "├─";
		const connector = isLast ? "   " : "│  ";

		// 트랙별 시그니처 컬러: displayCli(태스크포스 백엔드) 또는 job 캐리어 색상
		const trackColor = resolveCarrierColor(track.displayCli) ?? fallbackColor;
		const icon = trackStatusIcon(track, frame, trackColor);
		const name = `${trackColor}${trackDisplayName(track)}${ANSI_RESET}`;
		const stats = trackStatsText(track);

		lines.push(truncateToWidth(
			`${indent}${STREAM_PREFIX}${PANEL_DIM_COLOR}${branch}${ANSI_RESET} ${icon} ${name}${stats}`,
			width,
		));
		remaining--;

		// 활성(미완료) 트랙의 최근 스트리밍 표시
		if (!track.isComplete && remaining > 0 && track.blocks.length > 0) {
			const blockLines = renderBlockLines(track.blocks)
				.filter((bl) => bl.text.trim());
			const tailLines = blockLines.slice(-Math.min(2, remaining));
			const streamPrefix = `${indent}${STREAM_PREFIX}${PANEL_DIM_COLOR}${connector}${ANSI_RESET}  `;
			for (const bl of tailLines) {
				if (remaining <= 0) break;
				lines.push(truncateToWidth(`${streamPrefix}${blockLineToAnsi(bl)}`, width));
				remaining--;
			}
		}
	}
}

// ─── 싱글 트랙 스트리밍 ──────────────────────────────────

function appendSingleTrackStream(
	lines: string[],
	width: number,
	job: PanelJobViewModel,
	indent: string,
): void {
	const activeTrack = job.tracks.find((t) => !t.isComplete) ?? job.tracks[0];

	if (activeTrack) {
		const blockLines = renderBlockLines(activeTrack.blocks);
		const tailLines = blockLines.slice(-MAX_EXPANDED_STREAM_LINES);
		for (const bl of tailLines) {
			lines.push(truncateToWidth(`${indent}${STREAM_PREFIX}${blockLineToAnsi(bl)}`, width));
		}
	}
}

// ─── offset 계산 ─────────────────────────────────────────

function computeTileOffsets(tiles: string[]): number[] {
	const offsets: number[] = [];
	let pos = 0;
	for (let i = 0; i < tiles.length; i++) {
		offsets.push(pos);
		pos += visibleWidth(tiles[i]);
		if (i < tiles.length - 1) pos += SEPARATOR_VIS_W;
	}
	return offsets;
}

// ─── 포맷팅 헬퍼 ─────────────────────────────────────────

function carrierDisplayName(carrierId: string): string {
	return CLI_DISPLAY_NAMES[carrierId] ?? capitalize(carrierId);
}

function kindDisplayName(kind: string): string {
	return KIND_LABELS[kind] ?? capitalize(kind);
}

function capitalize(text: string): string {
	if (!text) return text;
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatJobTile(
	job: PanelJobViewModel,
	focused: boolean,
	frame: number,
): string {
	const carrierColor = resolveCarrierColor(job.ownerCarrierId);
	const icon = jobIcon(job.status, frame, carrierColor);
	const kind = kindDisplayName(job.kind);
	const trackCount = job.tracks.length > 1 ? `:${job.tracks.length}` : "";
	const carrierName = carrierDisplayName(job.ownerCarrierId);
	const label = `${carrierName}·${kind}${trackCount}`;

	if (focused) {
		const focusedLabel = waveText(
			label,
			resolveCarrierRgb(job.ownerCarrierId) ?? PANEL_RGB,
			frame,
		);
		return `${carrierColor}[${ANSI_RESET}${icon} ${focusedLabel}${ANSI_RESET}${carrierColor}]${ANSI_RESET}`;
	}

	return `${icon} ${carrierColor}${label}${ANSI_RESET}`;
}

function jobIcon(status: PanelJobViewModel["status"], frame: number, color?: string): string {
	if (status === "active") {
		const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
		return color ? `${color}${spinner}${ANSI_RESET}` : spinner;
	}
	if (status === "done") return `${COLOR_DONE}${SYM_INDICATOR}${ANSI_RESET}`;
	if (status === "error" || status === "aborted") return `${COLOR_ERROR}${SYM_INDICATOR}${ANSI_RESET}`;
	return `${PANEL_DIM_COLOR}○${ANSI_RESET}`;
}

function trackStatusIcon(track: PanelTrackViewModel, frame: number, color?: string): string {
	if (track.isComplete) {
		if (track.status === "err") return `${COLOR_ERROR}${SYM_INDICATOR}${ANSI_RESET}`;
		return `${COLOR_DONE}${SYM_INDICATOR}${ANSI_RESET}`;
	}
	const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
	return color ? `${color}${spinner}${ANSI_RESET}` : spinner;
}

function trackDisplayName(track: PanelTrackViewModel): string {
	if (track.kind === "backend") {
		return CLI_DISPLAY_NAMES[track.displayCli] ?? capitalize(track.displayCli);
	}
	return track.displayName;
}

function trackStatsText(track: PanelTrackViewModel): string {
	if (track.toolCallCount > 0) {
		return ` ${PANEL_DIM_COLOR}[${track.toolCallCount} tool${track.toolCallCount > 1 ? "s" : ""}]${ANSI_RESET}`;
	}
	return "";
}
