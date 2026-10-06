import { useEffect, useRef, type RefObject } from 'react';
import { Application, Filter, GlProgram, Sprite, Texture } from 'pixi.js';

/**
 * PixiJS (WebGL) preview of the editor raster.
 *
 * The 2D canvas keeps doing what it always did - it is the single source of
 * truth for pixels (grid overlay, subtexture, theme colours) - but it is
 * hidden while this viewport is mounted. Pixi uploads that raster as a
 * texture and can apply the CRT shader (barrel curvature, scanlines, glow,
 * vignette) on the GPU. Anything that fails (no WebGL, context loss) calls
 * `onFallback`, which switches the store back to the plain 2D canvas.
 *
 * Sync protocol: EditorCanvas stamps `data-raster-rev` on the source canvas
 * after every draw; a requestAnimationFrame loop uploads the texture when
 * that revision changes and re-renders the stage.
 */

/** Default PixiJS filter vertex shader (GLSL ES 3.00), verbatim. */
const CRT_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const CRT_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// Explicit highp: the default filter vertex shader declares this uniform
// under the vertex stage's highp default, and fragment shaders default to
// (or are preloaded with) mediump - a precision mismatch fails to link.
uniform highp vec4 uInputSize;
uniform float uCurvature;
uniform float uScanline;
uniform float uGlow;

vec2 curve(vec2 uv)
{
    uv = uv * 2.0 - 1.0;
    vec2 offset = abs(uv.yx) / vec2(4.0, 3.0);
    uv = uv + uv * offset * offset * uCurvature * 10.0;
    return uv * 0.5 + 0.5;
}

void main(void)
{
    vec2 uv = curve(vTextureCoord);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        finalColor = vec4(0.0);
        return;
    }

    vec4 color = texture(uTexture, uv);

    // Cheap wide glow: four offset taps of the (bright) source added back.
    vec2 px = 2.5 * uInputSize.zw;
    vec4 blur = texture(uTexture, uv + vec2(px.x, 0.0))
              + texture(uTexture, uv - vec2(px.x, 0.0))
              + texture(uTexture, uv + vec2(0.0, px.y))
              + texture(uTexture, uv - vec2(0.0, px.y));
    color.rgb += color.rgb * (blur.rgb * 0.25) * uGlow;

    // Scanlines tied to source pixel rows.
    float line = 0.82 + 0.18 * sin(vTextureCoord.y * uInputSize.y * 3.14159265);
    color.rgb *= mix(1.0, line, uScanline);

    // Corner vignette.
    vec2 q = vTextureCoord;
    float vig = smoothstep(0.0, 0.35, q.x) * smoothstep(1.0, 0.65, q.x)
              * smoothstep(0.0, 0.35, q.y) * smoothstep(1.0, 0.65, q.y);
    color.rgb *= mix(1.0, vig, 0.4);

    finalColor = color;
}
`;

interface PixiViewportProps {
  /** The 2D raster canvas feeding the texture (hidden while this is on). */
  sourceRef: RefObject<HTMLCanvasElement | null>;
  /** Apply the CRT shader (matches the CRT toolbar toggle). */
  crt: boolean;
  /** Called once when WebGL cannot start; the caller reverts to 2D. */
  onFallback: (reason: string) => void;
}

export function PixiViewport({ sourceRef, crt, onFallback }: PixiViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const crtRef = useRef(crt);
  crtRef.current = crt;
  const spriteRef = useRef<Sprite | null>(null);
  const filterRef = useRef<Filter | null>(null);

  // Re-apply the filter set when the CRT toggle changes; the render loop is
  // always running, so the next frame picks it up.
  useEffect(() => {
    const sprite = spriteRef.current;
    const filter = filterRef.current;
    if (!sprite) return;
    sprite.filters = crtRef.current && filter ? [filter] : [];
  }, [crt]);

  useEffect(() => {
    const source = sourceRef.current;
    const host = hostRef.current;
    if (!source || !host) {
      onFallback('canvas not ready');
      return;
    }

    let cancelled = false;
    let app: Application | null = null;
    let texture: Texture | null = null;
    let rafId = 0;
    let lastRev = '';
    let lastW = 0;
    let lastH = 0;

    const sync = () => {
      if (!app || !texture) return;
      const w = Math.max(1, source.width);
      const h = Math.max(1, source.height);
      if (w !== lastW || h !== lastH) {
        lastW = w;
        lastH = h;
        app.renderer.resize(w, h);
        app.canvas.style.width = `${w}px`;
        app.canvas.style.height = `${h}px`;
      }
      const rev = source.dataset.rasterRev ?? '';
      if (rev !== lastRev) {
        lastRev = rev;
        texture.source.update();
      }
      app.render();
    };

    (async () => {
      try {
        const instance = new Application();
        await instance.init({
          width: Math.max(1, source.width),
          height: Math.max(1, source.height),
          backgroundAlpha: 0,
          antialias: false,
          autoStart: false,
          preference: 'webgl',
        });
        if (cancelled) {
          instance.destroy(true, { children: true, texture: true, textureSource: true, context: true });
          return;
        }
        app = instance;
        const canvas = instance.canvas;
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.pointerEvents = 'none';
        host.appendChild(canvas);
        host.dataset.gpu = 'on';

        texture = Texture.from(source);
        const sprite = new Sprite(texture);
        spriteRef.current = sprite;
        instance.stage.addChild(sprite);

        const filter = new Filter({
          glProgram: GlProgram.from({
            vertex: CRT_VERTEX,
            fragment: CRT_FRAGMENT,
            name: 'crt-filter',
          }),
          resources: {
            crtUniforms: {
              uCurvature: { value: 0.14, type: 'f32' },
              uScanline: { value: 0.5, type: 'f32' },
              uGlow: { value: 1.1, type: 'f32' },
            },
          },
        });
        filterRef.current = filter;
        sprite.filters = crtRef.current ? [filter] : [];

        lastW = Math.max(1, source.width);
        lastH = Math.max(1, source.height);
        lastRev = source.dataset.rasterRev ?? '';
        texture.source.update();
        instance.render();

        const loop = () => {
          if (cancelled) return;
          try {
            sync();
          } catch {
            // A transient GL error must not kill the loop; the next frame
            // re-syncs from the 2D raster.
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      } catch (e) {
        if (cancelled) return;
        host.dataset.gpu = 'failed';
        onFallback(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      spriteRef.current = null;
      filterRef.current = null;
      if (app) {
        try {
          app.destroy(true, { children: true, texture: true, textureSource: true, context: true });
        } catch {
          /* context already lost */
        }
      }
    };
    // Mount-only: the CRT toggle is handled by the effect above, rasters by
    // the revision loop.
  }, []);

  return <div className="pixi-host" ref={hostRef} data-gpu="booting" />;
}
