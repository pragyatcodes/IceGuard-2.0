"use client";

import * as React from "react";
import {
  SMOKE_COLORS,
  SMOKE_CURSOR,
  SMOKE_FINISH,
  SMOKE_FRAG_SRC,
  SMOKE_SHAPE,
  SMOKE_SPACE,
  SMOKE_SURFACE,
  SMOKE_TIME_SCALE,
  SMOKE_TRANSFORM,
  SMOKE_VERT_SRC,
} from "@/lib/bg/smoke-shader";

/**
 * Animated "Smoke" flow-shader background from the 21st.dev Shader Builder.
 *
 * Plain WebGL1, one fullscreen triangle, no libraries. Renders behind page
 * content; the RAF loop pauses while the tab is hidden. If WebGL is
 * unavailable the cropped static artwork is shown instead so the page never
 * loses its backdrop.
 */
export function SmokeBackground({ className = "" }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    }) ?? null) as WebGLRenderingContext | null;

    if (!gl) {
      setFailed(true);
      return;
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[smoke-bg] shader compile failed:", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, SMOKE_VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, SMOKE_FRAG_SRC);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      setFailed(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[smoke-bg] link failed:", gl.getProgramInfoLog(prog));
      setFailed(true);
      return;
    }
    gl.useProgram(prog);

    // Fullscreen triangle — three vertices, no index buffer.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const loc = {
      colors: gl.getUniformLocation(prog, "u_colors[0]"),
      scene: gl.getUniformLocation(prog, "u_scene"),
      shape: gl.getUniformLocation(prog, "u_shape"),
      surface: gl.getUniformLocation(prog, "u_surface"),
      finish: gl.getUniformLocation(prog, "u_finish"),
      transform: gl.getUniformLocation(prog, "u_transform"),
      space: gl.getUniformLocation(prog, "u_space"),
      cursor: gl.getUniformLocation(prog, "u_cursor"),
    };

    gl.uniform3fv(loc.colors, SMOKE_COLORS);
    gl.uniform4fv(loc.shape, SMOKE_SHAPE);
    gl.uniform4fv(loc.surface, SMOKE_SURFACE);
    gl.uniform4fv(loc.finish, SMOKE_FINISH);
    gl.uniform4fv(loc.transform, SMOKE_TRANSFORM);
    gl.uniform4fv(loc.space, SMOKE_SPACE);
    gl.uniform4fv(loc.cursor, SMOKE_CURSOR);

    // Device pixel ratio capped at 2 — retina beyond that buys nothing here.
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    fit();

    const t0 = performance.now();
    let raf = 0;
    let running = false;

    const frame = (now: number) => {
      if (!running) return;
      fit();
      const seconds = (now - t0) / 1000;
      gl.uniform4f(loc.scene, canvas.width, canvas.height, seconds * SMOKE_TIME_SCALE, 4.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onResize = () => fit();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  if (failed) {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-cover bg-center ${className}`}
        style={{ backgroundImage: "url(/oceanic-currents.jpg)" }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
