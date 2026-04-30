import { describe, expect, it } from 'vitest';
import {
  codexDeveloperInstructionsToConfigArg,
  createSpawnConfig,
  getYoloModeId,
  mcpServerConfigsToCodexArgs,
} from '../../src/config/CliConfigs.js';

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

    it('Codex는 기본적으로 codex-acp bridge를 npx로 spawn한다', () => {
      const config = createSpawnConfig('codex', {
        cwd: '/tmp/workspace',
      });

      expect(config.command).toContain('npx');
      expect(config.args).toContain('--package=@zed-industries/codex-acp@0.12.0');
      expect(config.args).toContain('codex-acp');
      expect(config.useNpx).toBe(true);
    });

    it('Codex는 ACP bridge일 때 Codex 전용 -c 설정을 spawn 인자로 전달한다', () => {
      const config = createSpawnConfig('codex', {
        cwd: '/tmp/workspace',
        configOverrides: [
          'mcp_servers.pi-tools.url="http://127.0.0.1:54300"',
          'mcp_servers.pi-tools.tool_timeout_sec=1800',
        ],
      });

      expect(config.args).toEqual(expect.arrayContaining([
        '--package=@zed-industries/codex-acp@0.12.0',
        'codex-acp',
        '-c',
        'mcp_servers.pi-tools.url="http://127.0.0.1:54300"',
        '-c',
        'mcp_servers.pi-tools.tool_timeout_sec=1800',
      ]));
    });
  });

  describe('getYoloModeId', () => {
    it('CLI별 ACP YOLO 모드 ID를 반환한다', () => {
      expect(getYoloModeId('gemini')).toBe('yolo');
      expect(getYoloModeId('claude')).toBe('bypassPermissions');
      expect(getYoloModeId('codex')).toBe('yolo');
    });
  });

  describe('mcpServerConfigsToCodexArgs', () => {
    it('Codex developer_instructions 값을 TOML basic string으로 escape한다', () => {
      expect(codexDeveloperInstructionsToConfigArg('첫 줄\n"둘째"\\tail')).toBe(
        'developer_instructions="첫 줄\\n\\"둘째\\"\\\\tail"',
      );
    });

    it('TOML 문자열 값을 escape하고 tool timeout을 전달한다', () => {
      expect(mcpServerConfigsToCodexArgs([{
        type: 'http',
        name: 'pi-tools',
        url: 'http://127.0.0.1:1234/path?x="y"\nnext',
        headers: [{ name: 'Authorization', value: 'Bearer "token"\\tail' }],
        toolTimeout: 1800,
      }])).toEqual([
        'mcp_servers.pi-tools.url="http://127.0.0.1:1234/path?x=\\"y\\"\\nnext"',
        'mcp_servers.pi-tools.http_headers={"Authorization" = "Bearer \\"token\\"\\\\tail"}',
        'mcp_servers.pi-tools.tool_timeout_sec=1800',
      ]);
    });

    it('TOML key injection이 가능한 MCP 서버 이름을 거부한다', () => {
      expect(() => mcpServerConfigsToCodexArgs([{
        type: 'http',
        name: 'pi.tools',
        url: 'http://127.0.0.1:1234',
      }])).toThrow('MCP 서버 이름');
    });

    it('유효하지 않은 tool timeout을 거부한다', () => {
      expect(() => mcpServerConfigsToCodexArgs([{
        type: 'http',
        name: 'pi-tools',
        url: 'http://127.0.0.1:1234',
        toolTimeout: Number.NaN,
      }])).toThrow('toolTimeout');
    });
  });
});
