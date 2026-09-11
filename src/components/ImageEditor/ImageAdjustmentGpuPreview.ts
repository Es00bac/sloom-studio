import type { AdjustmentLayerKind, ImageAdjustmentSettings } from '../../types/imageEditor';

/**
 * Small, deliberately conservative WebGL2 route for the adjustment compositor.
 *
 * The CPU renderer remains authoritative: this path is only selected for the four
 * point-wise RGB adjustments whose shader math has no neighbour or document-stack
 * dependency. Masks, clipping, partial opacity, unsupported adjustments, unavailable
 * WebGL2, context loss, oversize textures, and any GL exception all return `null` so
 * the caller immediately executes the existing deterministic CPU path.
 */
const GPU_ADJUSTMENT_KINDS = new Set<AdjustmentLayerKind>([
  'brightnessContrast',
  'blackWhite',
  'invert',
  'exposure',
]);

/**
 * `readPixels` returns framebuffer row zero first. The full-screen triangle's
 * bottom edge must therefore sample texture row zero, which is the first
 * (top) ImageData row uploaded by `texImage2D` below. Keep the expression
 * exported so the deterministic orientation regression exercises the same
 * shader contract even when Node has no WebGL implementation.
 */
export const GPU_TEXTURE_V_FROM_NDC_Y_GLSL = 'aPos.y * 0.5 + 0.5';

/**
 * Black & White's byte-domain weights are shared by the CPU contract and the
 * shader's integer expression below. Keeping the offset in the integer
 * numerator makes every half-byte tie deterministic on both routes, including
 * ties whose IEEE-double representation falls infinitesimally below .5.
 */
export const GPU_BLACK_WHITE_WEIGHTS = [2126, 7152, 722] as const;
export const GPU_BLACK_WHITE_ROUNDING_OFFSET = 5000;

export function blackWhiteLumaByte(r: number, g: number, b: number): number {
  const red = Math.max(0, Math.min(255, Math.round(r)));
  const green = Math.max(0, Math.min(255, Math.round(g)));
  const blue = Math.max(0, Math.min(255, Math.round(b)));
  const weighted = red * GPU_BLACK_WHITE_WEIGHTS[0]
    + green * GPU_BLACK_WHITE_WEIGHTS[1]
    + blue * GPU_BLACK_WHITE_WEIGHTS[2];
  return Math.floor((weighted + GPU_BLACK_WHITE_ROUNDING_OFFSET) / 10000);
}

export function gpuTextureVFromNdcY(ndcY: number): number {
  return ndcY * 0.5 + 0.5;
}

export const GPU_ADJUSTMENT_VERTEX_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Framebuffer row zero is returned as ImageData row zero, so it samples the
  // first uploaded ImageData row rather than vertically mirroring the bitmap.
  vUv = vec2(aPos.x * 0.5 + 0.5, ${GPU_TEXTURE_V_FROM_NDC_Y_GLSL});
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const GPU_ADJUSTMENT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform int uKind;
uniform vec4 uParams;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 source = texture(uSource, vUv);
  vec3 rgb = source.rgb;
  if (uKind == 0) {
    rgb = clamp(uParams.y * (rgb - vec3(0.5019608)) + vec3(0.5019608 + uParams.x), 0.0, 1.0);
  } else if (uKind == 1) {
    // Match blackWhiteLumaByte's total integer byte-domain contract exactly.
    // Do not leave channel or half-byte conversion to the RGBA8 framebuffer.
    ivec3 sourceBytes = ivec3(floor(rgb * 255.0 + vec3(0.5)));
    int weightedLuma = sourceBytes.r * 2126 + sourceBytes.g * 7152 + sourceBytes.b * 722;
    int lumaByte = (weightedLuma + 5000) / 10000;
    rgb = vec3(float(lumaByte) / 255.0);
  } else if (uKind == 2) {
    rgb = vec3(1.0) - rgb;
  } else if (uKind == 3) {
    rgb = pow(max(rgb * exp2(uParams.x) + vec3(uParams.y), vec3(0.0)), vec3(1.0 / uParams.z));
  }
  fragColor = vec4(rgb, source.a);
}`;

export interface GpuAdjustmentPreviewOptions {
  opacity?: number;
  hasMask?: boolean;
  hasClippingMask?: boolean;
}

export interface GpuAdjustmentPreviewSupport {
  eligible: boolean;
  supportedKinds: readonly AdjustmentLayerKind[];
  reason: string;
}

export function describeGpuAdjustmentPreview(
  adjustment: ImageAdjustmentSettings,
  options: GpuAdjustmentPreviewOptions = {},
): GpuAdjustmentPreviewSupport {
  if (!GPU_ADJUSTMENT_KINDS.has(adjustment.kind)) {
    return {
      eligible: false,
      supportedKinds: [...GPU_ADJUSTMENT_KINDS],
      reason: `${adjustment.kind} uses the deterministic CPU adjustment renderer.`,
    };
  }
  if (options.hasMask) {
    return { eligible: false, supportedKinds: [...GPU_ADJUSTMENT_KINDS], reason: 'Layer masks use the deterministic CPU adjustment renderer.' };
  }
  if (options.hasClippingMask) {
    return { eligible: false, supportedKinds: [...GPU_ADJUSTMENT_KINDS], reason: 'Clipped adjustments use the deterministic CPU adjustment renderer.' };
  }
  if ((options.opacity ?? 1) !== 1) {
    return { eligible: false, supportedKinds: [...GPU_ADJUSTMENT_KINDS], reason: 'Partial-opacity adjustments use the deterministic CPU adjustment renderer.' };
  }
  return {
    eligible: true,
    supportedKinds: [...GPU_ADJUSTMENT_KINDS],
      reason: 'Eligible for a capability-gated WebGL2 compositor path. It can feed live preview, merge/flatten, and raster export for this exact layer; CPU fallback is automatic when GPU resources are unavailable.',
  };
}

/**
 * Returns a GPU result only when the route is safe and available. `null` is a normal,
 * expected fallback signal and must never be treated as an adjustment failure.
 */
export function tryApplyAdjustmentGpu(
  source: ImageData,
  adjustment: ImageAdjustmentSettings,
  options: GpuAdjustmentPreviewOptions = {},
): ImageData | null {
  if (!describeGpuAdjustmentPreview(adjustment, options).eligible) return null;
  if (typeof OffscreenCanvas === 'undefined' || source.width <= 0 || source.height <= 0) return null;

  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  try {
    const canvas = new OffscreenCanvas(source.width, source.height);
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      stencil: false,
    });
    if (!gl || gl.isContextLost()) return null;
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (source.width > maxTexture || source.height > maxTexture) return null;

    vertex = compile(gl, gl.VERTEX_SHADER, GPU_ADJUSTMENT_VERTEX_SHADER);
    fragment = compile(gl, gl.FRAGMENT_SHADER, GPU_ADJUSTMENT_FRAGMENT_SHADER);
    if (!vertex || !fragment) return null;
    program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const bytes = source.data instanceof Uint8Array
      ? source.data
      : new Uint8Array(source.data.buffer, source.data.byteOffset, source.data.byteLength);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);

    gl.viewport(0, 0, source.width, source.height);
    gl.useProgram(program);
    const sourceLocation = gl.getUniformLocation(program, 'uSource');
    const kindLocation = gl.getUniformLocation(program, 'uKind');
    const paramsLocation = gl.getUniformLocation(program, 'uParams');
    if (!sourceLocation || !kindLocation || !paramsLocation) return null;
    gl.uniform1i(sourceLocation, 0);
    const [kind, params] = shaderParameters(adjustment);
    gl.uniform1i(kindLocation, kind);
    gl.uniform4f(paramsLocation, params[0], params[1], params[2], params[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) return null;

    const data = new Uint8ClampedArray(source.width * source.height * 4);
    gl.readPixels(0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) return null;
    return { width: source.width, height: source.height, data } as ImageData;
  } catch {
    return null;
  } finally {
    if (gl) {
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
    }
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function shaderParameters(adjustment: ImageAdjustmentSettings): [number, [number, number, number, number]] {
  switch (adjustment.kind) {
    case 'brightnessContrast': {
      const contrast = Math.max(-255, Math.min(255, adjustment.contrast));
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      return [0, [adjustment.brightness / 255, factor, 0, 0]];
    }
    case 'blackWhite': return [1, [0, 0, 0, 0]];
    case 'invert': return [2, [0, 0, 0, 0]];
    case 'exposure': return [3, [adjustment.exposure, adjustment.offset, Math.max(0.01, adjustment.gamma || 1), 0]];
    default: return [0, [0, 1, 0, 0]];
  }
}
