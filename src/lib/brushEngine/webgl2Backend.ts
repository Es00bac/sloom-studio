import type { LayerBitmap } from '../../types/imageEditor';
import type { BrushBackend, BrushDab, Rect, StrokeSession } from './backend';
import { clampRect, dabRect, isEmptyRect, unionRect } from './dirtyRect';

/**
 * WebGL2 brush backend. Uploads the layer once, runs a fragment-shader pass per dab (ping-pong
 * textures so neighbourhood ops never self-feed), and reads back only the accumulated dirty region
 * once on commit. The shaders use integer `texelFetch` + the same disc/average math as the CPU
 * reference, so output matches within tolerance. Returns null when WebGL2 is unavailable.
 */

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// uOp: 0 = smudge, 1 = blur, 2 = sharpen.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uWorking;
uniform highp sampler2D uSample;
uniform vec2 uTarget;      // round(to) in texels
uniform vec2 uDrag;        // round(from) - round(to), in texels (smudge)
uniform float uBrushRadius;
uniform float uStrength;
uniform int uBlurRadius;
uniform int uOp;
uniform ivec2 uSize;       // texture dimensions
out vec4 fragColor;

vec4 fetchClamped(sampler2D tex, ivec2 p) {
  ivec2 c = clamp(p, ivec2(0), uSize - 1);
  return texelFetch(tex, c, 0);
}

void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy));
  vec4 working = texelFetch(uWorking, p, 0);
  float dist = distance(vec2(p), uTarget);
  if (dist > uBrushRadius + 0.001) { fragColor = working; return; }

  if (uOp == 0) {
    // smudge: pull the drag-origin colour (uses clamp-edge sampling like the CPU kernel)
    vec4 origin = fetchClamped(uSample, p + ivec2(uDrag));
    fragColor = mix(working, origin, uStrength);
    return;
  }

  // blur / sharpen: circular-disc average of the sample texture (skip out-of-bounds)
  vec4 sum = vec4(0.0);
  float count = 0.0;
  int r = uBlurRadius;
  for (int dy = -64; dy <= 64; dy++) {
    if (dy < -r || dy > r) continue;
    for (int dx = -64; dx <= 64; dx++) {
      if (dx < -r || dx > r) continue;
      if (float(dx * dx + dy * dy) > float(r) * float(r) + 0.001) continue;
      ivec2 s = p + ivec2(dx, dy);
      if (s.x < 0 || s.y < 0 || s.x >= uSize.x || s.y >= uSize.y) continue;
      sum += texelFetch(uSample, s, 0);
      count += 1.0;
    }
  }
  if (count == 0.0) { fragColor = working; return; }
  vec4 avg = floor(sum / count * 255.0 + 0.5) / 255.0; // match CPU's rounded average
  if (uOp == 1) {
    fragColor = mix(working, avg, uStrength);
  } else {
    fragColor = vec4(working.rgb + (working.rgb - avg.rgb) * uStrength, working.a);
  }
}`;

interface GlContext {
  gl: WebGL2RenderingContext;
  canvas: OffscreenCanvas;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

let cached: GlContext | null | undefined;

function getGlContext(): GlContext | null {
  if (cached !== undefined) return cached;
  cached = createGlContext();
  return cached;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createGlContext(): GlContext | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  // The whole setup is wrapped: a missing/partial/stubbed WebGL2 implementation (jsdom test stubs,
  // headless drivers, blocklisted GPUs) can return a truthy context whose methods throw. Any failure
  // here must cleanly return null so detection falls back to the CPU backend instead of crashing.
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl || typeof gl.createShader !== 'function') return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) return null;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const uniforms: GlContext['uniforms'] = {};
    for (const name of ['uWorking', 'uSample', 'uTarget', 'uDrag', 'uBrushRadius', 'uStrength', 'uBlurRadius', 'uOp', 'uSize']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { gl, canvas, program, vao, uniforms };
  } catch {
    return null;
  }
}

export function isWebgl2BrushBackendAvailable(): boolean {
  return getGlContext() !== null;
}

function createTexture(gl: WebGL2RenderingContext, width: number, height: number, pixels: Uint8ClampedArray | null): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels ? new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) : null);
  return tex;
}

const OP_CODES: Record<BrushDab['op'], number> = { smudge: 0, blur: 1, sharpen: 2 };

export function createWebgl2BrushBackend(): BrushBackend | null {
  const ctx = getGlContext();
  if (!ctx) return null;
  const { gl, program, vao, uniforms } = ctx;

  return {
    id: 'webgl2',
    beginStroke({ source, sampleSource, width, height }) {
      // Textures store rows top-down (row 0 = image top); we flip on readback.
      let texA = createTexture(gl, width, height, source.data);
      let texB = createTexture(gl, width, height, null);
      const texSample = createTexture(gl, width, height, sampleSource.imageData.data);
      const fbo = gl.createFramebuffer()!;
      let dirty: Rect | null = null;

      const readBack = (target: LayerBitmap): Rect | null => {
        if (!dirty || isEmptyRect(dirty)) return null;
        const ctx2d = target.getContext('2d');
        if (!ctx2d) return null;
        const { x, y, width: w, height: h } = dirty;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texA, 0);
        const buf = new Uint8Array(w * h * 4);
        // Texel index == ImageData row throughout (upload, sample, write, read), so glReadPixels at
        // framebuffer y == image row y returns rows already in image order — no flip needed.
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const data = new Uint8ClampedArray(buf);
        const imageData = typeof ImageData !== 'undefined'
          ? new ImageData(data, w, h)
          : ({ width: w, height: h, data } as ImageData);
        ctx2d.putImageData(imageData, x, y);
        return dirty;
      };

      const session: StrokeSession = {
        stampDab(dab: BrushDab) {
          const rect = clampRect(dabRect(dab.to.x, dab.to.y, dab.size), width, height);
          if (isEmptyRect(rect)) return;
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texB, 0);
          gl.viewport(0, 0, width, height);
          gl.useProgram(program);
          gl.bindVertexArray(vao);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texA);
          gl.uniform1i(uniforms.uWorking, 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, texSample);
          gl.uniform1i(uniforms.uSample, 1);
          const tcx = Math.round(dab.to.x);
          const tcy = Math.round(dab.to.y);
          gl.uniform2f(uniforms.uTarget, tcx, tcy);
          gl.uniform2f(uniforms.uDrag, Math.round(dab.from.x) - tcx, Math.round(dab.from.y) - tcy);
          gl.uniform1f(uniforms.uBrushRadius, Math.max(0, (dab.size - 1) / 2));
          gl.uniform1f(uniforms.uStrength, Math.min(1, Math.max(0, dab.strength)));
          gl.uniform1i(uniforms.uBlurRadius, Math.max(1, Math.ceil(dab.size)));
          gl.uniform1i(uniforms.uOp, OP_CODES[dab.op]);
          gl.uniform2i(uniforms.uSize, width, height);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          const swap = texA; texA = texB; texB = swap;
          dirty = unionRect(dirty, rect);
        },
        dirtyRect: () => dirty,
        previewInto: readBack,
        commit: readBack,
        dispose() {
          gl.deleteTexture(texA);
          gl.deleteTexture(texB);
          gl.deleteTexture(texSample);
          gl.deleteFramebuffer(fbo);
          dirty = null;
        },
      };
      return session;
    },
  };
}
