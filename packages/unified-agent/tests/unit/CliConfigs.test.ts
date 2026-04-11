import { describe, expect, it } from 'vitest';
import { createSpawnConfig, createPreSpawnConfig, getYoloModeId } from '../../src/config/CliConfigs.js';

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
      expect(config.args).toContain('--package=@agentclientprotocol/claude-agent-acp@0.26.0');
      expect(config.args).toContain('claude-agent-acp');
      expect(config.useNpx).toBe(true);
    });

    it('Codex도 npx --package 형태로 브리지를 실행한다', () => {
      const config = createSpawnConfig('codex', {
        cwd: '/tmp/workspace',
      });

      expect(config.command).toContain('npx');
      expect(config.args).toContain('--package=@zed-industries/codex-acp@^0.11.0');
      expect(config.args).toContain('codex-acp');
      expect(config.useNpx).toBe(true);
    });
  });

  describe('createPreSpawnConfig', () => {
    it('Gemini pre-spawn: model 없이 --acp만 반환', () => {
      const config = createPreSpawnConfig('gemini');

      expect(config.command).toBe('gemini');
      expect(config.args).toEqual(['--acp']);
      expect(config.useNpx).toBe(false);
    });

    it('Gemini pre-spawn: model 옵션 있어도 --model 미포함', () => {
      const config = createPreSpawnConfig('gemini', {
        model: 'gemini-2.5-pro',
      });

      expect(config.args).toEqual(['--acp']);
      expect(config.args).not.toContain('--model');
    });

    it('Claude pre-spawn: npx 브릿지 무변화', () => {
      const preConfig = createPreSpawnConfig('claude');
      const spawnConfig = createSpawnConfig('claude', { cwd: '' });

      expect(preConfig.command).toBe(spawnConfig.command);
      expect(preConfig.args).toEqual(spawnConfig.args);
      expect(preConfig.useNpx).toBe(spawnConfig.useNpx);
    });

    it('Codex pre-spawn: npx 브릿지 무변화', () => {
      const config = createPreSpawnConfig('codex');

      expect(config.useNpx).toBe(true);
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
