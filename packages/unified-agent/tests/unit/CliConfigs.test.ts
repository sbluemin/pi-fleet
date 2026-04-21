import { describe, expect, it } from 'vitest';
import { createSpawnConfig, getYoloModeId } from '../../src/config/CliConfigs.js';

describe('CliConfigs', () => {
  describe('createSpawnConfig', () => {
    it('Gemini ACP는 --acp로 spawn한다', () => {
      const config = createSpawnConfig('gemini', {
        cwd: '/tmp/workspace',
      });

      expect(config.command).toBe('gemini');
      expect(config.args).toEqual(['--acp']);
      expect(config.useNpx).toBe(false);
    });

    it('Gemini YOLO는 spawn 시 --approval-mode=yolo를 포함한다', () => {
      const config = createSpawnConfig('gemini', {
        cwd: '/tmp/workspace',
        yoloMode: true,
        model: 'gemini-2.5-pro',
      });

      expect(config.args).toEqual([
        '--acp',
        '--approval-mode=yolo',
        '--model',
        'gemini-2.5-pro',
      ]);
    });

    it('Claude는 1M 지원이 포함된 최신 ACP 브리지를 사용한다', () => {
      const config = createSpawnConfig('claude', {
        cwd: '/tmp/workspace',
      });

      expect(config.command).toContain('npx');
      expect(config.args).not.toContain('--prefer-offline');
      expect(config.args).toContain('--package=@agentclientprotocol/claude-agent-acp@0.29.2');
      expect(config.args).toContain('claude-agent-acp');
      expect(config.useNpx).toBe(true);
    });

    it('Codex도 npx --package 형태로 브리지를 실행한다', () => {
      const config = createSpawnConfig('codex', {
        cwd: '/tmp/workspace',
      });

      expect(config.command).toContain('npx');
      expect(config.args).not.toContain('--prefer-offline');
      expect(config.args).toContain('--package=@zed-industries/codex-acp@0.11.1');
      expect(config.args).toContain('codex-acp');
      expect(config.args).toContain('-c');
      expect(config.args).toContain('service_tier="fast"');
      expect(config.useNpx).toBe(true);
    });

    it('Codex configOverrides가 -c 인자로 병합된다', () => {
      const config = createSpawnConfig('codex', {
        cwd: '/tmp/workspace',
        configOverrides: ['mcp_servers.pi-tools.tool_timeout_sec=1800'],
      });

      expect(config.args).toContain('service_tier="fast"');
      expect(config.args).toContain('mcp_servers.pi-tools.tool_timeout_sec=1800');
    });
  });

  describe('getYoloModeId', () => {
    it('CLI별 ACP YOLO 모드 ID를 반환한다', () => {
      expect(getYoloModeId('gemini')).toBe('yolo');
      expect(getYoloModeId('claude')).toBe('bypassPermissions');
      expect(getYoloModeId('codex')).toBe('yolo');
    });
  });
});
