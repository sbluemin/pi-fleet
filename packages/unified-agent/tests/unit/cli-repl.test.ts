import { describe, expect, it, vi } from 'vitest';
import picocolors from 'picocolors';

import { handleEffortSlashCommand } from '../../src/cli-repl.js';

const ce = picocolors.createColors(false);

describe('cli-repl /effort', () => {
  it.each(['claude', 'gemini'] as const)(
    '%s는 unsupported provider이므로 /effort high를 안내 후 무시한다',
    async (cli) => {
      const setConfigOption = vi.fn<(...args: [string, string]) => Promise<void>>().mockResolvedValue(undefined);
      const setEffort = vi.fn();
      const writes: string[] = [];

      await handleEffortSlashCommand({
        cli,
        arg: 'high',
        ce,
        currentEffort: null,
        setEffort,
        setConfigOption,
        writeLine: (text) => { writes.push(text); },
      });

      expect(setConfigOption).not.toHaveBeenCalled();
      expect(setEffort).not.toHaveBeenCalled();
      expect(writes.join('')).toContain(`${cli} CLI는 reasoning effort를 지원하지 않아 /effort high 를 무시합니다`);
    },
  );

  it('codex는 supported provider이므로 /effort high에서 reasoning_effort를 설정한다', async () => {
    const setConfigOption = vi.fn<(...args: [string, string]) => Promise<void>>().mockResolvedValue(undefined);
    const setEffort = vi.fn();
    const writes: string[] = [];

    await handleEffortSlashCommand({
      cli: 'codex',
      arg: 'high',
      ce,
      currentEffort: null,
      setEffort,
      setConfigOption,
      writeLine: (text) => { writes.push(text); },
    });

    expect(setConfigOption).toHaveBeenCalledWith('reasoning_effort', 'high');
    expect(setEffort).toHaveBeenCalledWith('high');
    expect(writes.join('')).toContain('reasoning effort 변경: high');
  });
});
