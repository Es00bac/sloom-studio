import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Android Video timeline relay source', () => {
  it('advertises simultaneous collaboration to current desktop clients', () => {
    const source = readFileSync(
      new URL('../../android/app/src/main/java/studio/sloom/slstapp/LanAppServer.java', import.meta.url),
      'utf8',
    );
    expect(source).toContain('collaborationMode');
    expect(source).toContain('simultaneous');
  });

  it('rejects an oversized metadata mutation before parsing its body', () => {
    const source = readFileSync(
      new URL('../../android/app/src/main/java/studio/sloom/slstapp/SignalLoomLanServerPlugin.java', import.meta.url),
      'utf8',
    );
    const limitIndex = source.indexOf('contentLength > MAX_VIDEO_TIMELINE_MUTATION_BYTES');
    const parseIndex = source.indexOf('session.parseBody(body)');
    expect(source).toContain('MAX_VIDEO_TIMELINE_MUTATION_BYTES = 1_500_000');
    expect(source).toContain('session.getUri().endsWith("/project/video/mutate")');
    expect(limitIndex).toBeGreaterThan(0);
    expect(parseIndex).toBeGreaterThan(limitIndex);
  });

  it('uses NanoHTTPD body parsing instead of blocking on the raw request stream', () => {
    const source = readFileSync(
      new URL('../../android/app/src/main/java/studio/sloom/slstapp/SignalLoomLanServerPlugin.java', import.meta.url),
      'utf8',
    );
    expect(source).toContain('session.parseBody(body)');
    expect(source).not.toContain('session.getInputStream()');
    expect(source).not.toContain('while (read < contentLength)');
  });

  it('reads NanoHTTPD PUT bodies from its temporary content file', () => {
    const source = readFileSync(
      new URL('../../android/app/src/main/java/studio/sloom/slstapp/SignalLoomLanServerPlugin.java', import.meta.url),
      'utf8',
    );
    expect(source).toContain('String inline = body.get("postData")');
    expect(source).toContain('String contentPath = body.get("content")');
    expect(source).toContain('new FileInputStream(contentPath)');
    expect(source).toContain('total > maxBytes');
  });

  it('rejects oversized direct assets before constructing an evaluated relay script', () => {
    const source = readFileSync(
      new URL('../../android/app/src/main/java/studio/sloom/slstapp/SignalLoomLanServerPlugin.java', import.meta.url),
      'utf8',
    );
    const directLimitIndex = source.indexOf('contentLength > MAX_DIRECT_ASSET_RELAY_BYTES');
    const parseIndex = source.indexOf('session.parseBody(body)');
    expect(source).toContain('MAX_DIRECT_ASSET_RELAY_BYTES = 600_000');
    expect(source).toContain('use-chunked-asset-upload');
    expect(source).toContain('uri.startsWith("/__loom/api/asset-upload/")');
    expect(source).toContain('uri.contains("/asset-upload/")');
    expect(source).toContain('inline.getBytes(StandardCharsets.UTF_8).length > maxBytes');
    expect(directLimitIndex).toBeGreaterThan(0);
    expect(parseIndex).toBeGreaterThan(directLimitIndex);
  });

  it('resumes a backgrounded WebView before dispatching every JS-backed relay request', () => {
    const source = readFileSync(
      new URL('../../android/app/src/main/java/studio/sloom/slstapp/SignalLoomLanServerPlugin.java', import.meta.url),
      'utf8',
    );
    const dispatchIndex = source.indexOf('dispatchLanRequest(req)');
    const waitIndex = source.indexOf('latch.await(RELAY_TIMEOUT_SECONDS');
    const resumeIndex = source.indexOf('resumeWebView(currentWebView);');
    const evaluateIndex = source.indexOf('currentWebView.evaluateJavascript(script, result -> {');
    expect(dispatchIndex).toBeGreaterThan(0);
    expect(waitIndex).toBeGreaterThan(dispatchIndex);
    expect(resumeIndex).toBeGreaterThan(waitIndex);
    expect(evaluateIndex).toBeGreaterThan(resumeIndex);
    expect(source).toContain('Base64.encodeToString');
    expect(source).toContain('MAIN_HANDLER.post(() -> {');
    expect(source).not.toContain('webView.post(() -> {');
    expect(source).toContain("if(Date.now()>expiresAt)return 'sloom-relay-expired'");
    expect(source).toContain('request.toString().getBytes(StandardCharsets.UTF_8)');
    expect(source).toContain('detail:JSON.parse(');
    expect(source).toContain("return 'sloom-relay-dispatched'");
    expect(source).not.toContain('relayedRequests');
    expect(source).toContain('webView.setRendererPriorityPolicy');
    expect(source).toContain('webView.resumeTimers()');
  });

  it('validates the decoded request delivered by the wake-capable event', () => {
    const source = readFileSync(new URL('./androidLanServer.ts', import.meta.url), 'utf8');
    expect(source).toContain("window.addEventListener('sloom-native-lan-request'");
    expect(source).toContain('isLanRelayRequest(request)');
    expect(source).toContain('void handleLanRequest(request)');
  });
});
