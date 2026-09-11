import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron native CLI-agent IPC source guards', () => {
  const main = readFileSync(join(process.cwd(), 'electron/main.mjs'), 'utf8');
  const preload = readFileSync(join(process.cwd(), 'electron/preload.cjs'), 'utf8');
  const boundary = readFileSync(join(process.cwd(), 'electron/native-cli-agent.cjs'), 'utf8');

  it('keeps capability, execution, and cancellation behind narrow preload methods', () => {
    expect(preload).toContain("nativeCliAgentCapabilities: () => ipcRenderer.invoke('signal-loom:native-cli-agent-capabilities')");
    expect(preload).toContain("runNativeCliAgent: (request) => ipcRenderer.invoke('signal-loom:native-cli-agent-run', request)");
    expect(preload).toContain("cancelNativeCliAgent: (requestId) => ipcRenderer.invoke('signal-loom:native-cli-agent-cancel', requestId)");
    expect(main).toContain("ipcMain.handle('signal-loom:native-cli-agent-run'");
    expect(main).toContain('MAX_CONCURRENT_NATIVE_CLI_AGENTS = 2');
  });

  it('requires explicit consent before spawning and scopes repeat consent to the live-layout session', () => {
    expect(main).toMatch(/nativeCliAgentControllers\.set\(request\.requestId, controller\)[\s\S]*dialog\.showMessageBox[\s\S]*const approved =[\s\S]*if \(!approved[\s\S]*executeNativeCliAgent/);
    // Ordinary writing and one-shot assisted-layout requests retain per-run consent.
    expect(main).toContain("buttons: ['Send Once', 'Cancel']");
    expect(main).toContain('defaultId: 1');
    expect(main).toContain('cancelId: 1');
    // Only the iterative live-layout purpose may reuse an approval, bounded to this renderer window,
    // selected agent, and a 30-minute expiry. It still offers one-turn approval and cancellation.
    expect(main).toContain("request.purpose === 'live-layout-agent'");
    expect(main).toContain('`${event.sender.id}:${request.agent}`');
    expect(main).toContain("buttons: ['Allow This Session', 'Send Once', 'Cancel']");
    expect(main).toContain('LIVE_LAYOUT_AGENT_SESSION_CONSENT_TTL_MS = 30 * 60 * 1000');
    expect(main).toMatch(/isLiveLayoutAgent && consent\.response === 0[\s\S]*liveLayoutAgentSessionConsents\.set/);
  });

  it('uses fixed argv plus stdin without a renderer-controlled shell or executable path', () => {
    expect(boundary).toContain("shell: false");
    expect(boundary).toContain("child.stdin?.end(prompt, 'utf8')");
    expect(boundary).not.toMatch(/exec\s*\(/);
    expect(boundary).not.toMatch(/request\.(?:command|executable|cwd|args)/);
    expect(boundary).toContain("tools: []");
    expect(boundary).toContain("'--sandbox', 'read-only'");
    expect(boundary).toContain("'--tools', ''");
  });
});
