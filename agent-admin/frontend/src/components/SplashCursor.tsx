// @ts-nocheck
// WebGL 流体仿真 + 字符雨叠加效果。
// 移植自 Splash Cursor Effect 参考 HTML（Jos Stam 1999 Stable Fluids）。
//
// 整体原 IIFE 代码迁移到 React 组件，关键变化：
//   1. DOM 引用 useRef 替换 getElementById；
//   2. 字符集 chars 由 props 传入，用 ref 缓存让动画 loop 闭包随站点信息异步更新而生效；
//   3. useEffect 内初始化、返回 cleanup 清理 RAF / DOM 监听器；
//   4. TypeScript 整个文件 @ts-nocheck（WebGL API 类型注释代价过高，原 JS 已稳定）。

import { useEffect, useRef } from 'react'

interface Props {
  /** 字符雨字符集；通常传入站点标题拆字结果 */
  chars: string[]
  /** 自定义颜色调色板（可选）；默认蓝紫色调 */
  palette?: Array<{ r: number; g: number; b: number }>
}

const DEFAULT_PALETTE = [
  { r: 0.239, g: 0.341, b: 0.784 },
  { r: 0.373, g: 0.475, b: 0.910 },
  { r: 0.557, g: 0.651, b: 0.969 },
  { r: 0.902, g: 0.914, b: 0.969 },
]

const FALLBACK_CHARS = ['·', '+', '·', '*', '·']

export default function SplashCursor({ chars, palette }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fluidRef = useRef<HTMLCanvasElement>(null)
  const charsRef = useRef<HTMLCanvasElement>(null)
  const charSetRef = useRef<string[]>(FALLBACK_CHARS)
  const paletteRef = useRef(palette && palette.length > 0 ? palette : DEFAULT_PALETTE)

  // 把外部 chars 同步到 ref，让动画 loop 内闭包随站点信息更新取到最新值
  useEffect(() => {
    charSetRef.current = chars && chars.length > 0 ? chars : FALLBACK_CHARS
  }, [chars])

  useEffect(() => {
    paletteRef.current = palette && palette.length > 0 ? palette : DEFAULT_PALETTE
  }, [palette])

  useEffect(() => {
    const fluidCanvas = fluidRef.current
    const charCanvas = charsRef.current
    const container = containerRef.current
    if (!fluidCanvas || !charCanvas || !container) return

    const charCtx = charCanvas.getContext('2d')
    if (!charCtx) return

    // ============================================================
    // 配置
    // ============================================================
    const CONFIG = {
      SIM_RESOLUTION: 128,
      DYE_RESOLUTION: 1440,
      DENSITY_DISSIPATION: 3.5,
      VELOCITY_DISSIPATION: 2,
      PRESSURE: 0.1,
      PRESSURE_ITERATIONS: 20,
      CURL: 3,
      SPLAT_RADIUS: 0.2,
      SPLAT_FORCE: 6000,
      SHADING: true,
      COLOR_UPDATE_SPEED: 10,
      BACK_COLOR: { r: 0, g: 0, b: 0 },
      TRANSPARENT: true,
    }

    const CELL_SIZE = 22
    const CHAR_COLOR = '190, 200, 240'
    const ALPHA_DECAY_RATE = 0.62
    const INIT_ALPHA = 0.28

    // ============================================================
    // 字符雨网格
    // ============================================================
    let gridCols = 0
    let gridRows = 0
    let charGrid: Array<{ char: string; alpha: number }> = []

    function pickChar() {
      const set = charSetRef.current
      return set[Math.floor(Math.random() * set.length)]
    }

    function initCharGrid() {
      gridCols = Math.max(1, Math.floor(charCanvas.width / CELL_SIZE))
      gridRows = Math.max(1, Math.floor(charCanvas.height / CELL_SIZE))
      const total = gridCols * gridRows
      if (charGrid.length > total) charGrid.length = total
      for (let i = 0; i < total; i++) {
        if (charGrid[i]) {
          charGrid[i].alpha = Math.min(charGrid[i].alpha, INIT_ALPHA)
        } else {
          charGrid[i] = { char: pickChar(), alpha: 0 }
        }
      }
    }

    function resizeCharCanvas() {
      const dpr = window.devicePixelRatio || 1
      const w = Math.floor(fluidCanvas.clientWidth * dpr)
      const h = Math.floor(fluidCanvas.clientHeight * dpr)
      if (charCanvas.width !== w || charCanvas.height !== h) {
        charCanvas.width = w
        charCanvas.height = h
        initCharGrid()
      }
    }

    function activateCharsClose(px: number, py: number, intensity: number) {
      if (!charGrid.length) return
      const cx = Math.floor(px / CELL_SIZE)
      const cy = Math.floor(py / CELL_SIZE)
      const radius = Math.max(1, Math.floor(2 + intensity * 1.6))
      for (let row = cy - radius; row <= cy + radius; row++) {
        if (row < 0 || row >= gridRows) continue
        for (let col = cx - radius; col <= cx + radius; col++) {
          if (col < 0 || col >= gridCols) continue
          const dx = col - cx
          const dy = row - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > radius) continue
          const idx = row * gridCols + col
          const cell = charGrid[idx]
          if (cell && Math.random() < 0.86 - (dist / (radius + 0.01)) * 0.5) {
            cell.char = pickChar()
            const a = 0.15 + (1 - dist / (radius + 0.001)) * 0.42
            cell.alpha = Math.min(0.75, Math.max(cell.alpha, a))
          }
        }
      }
    }

    function activateCharsWide(px: number, py: number, intensity: number) {
      if (!charGrid.length) return
      const cx = Math.floor(px / CELL_SIZE)
      const cy = Math.floor(py / CELL_SIZE)
      const radius = Math.max(1, Math.floor(3 + intensity * 2.4))
      for (let row = cy - radius; row <= cy + radius; row++) {
        if (row < 0 || row >= gridRows) continue
        for (let col = cx - radius; col <= cx + radius; col++) {
          if (col < 0 || col >= gridCols) continue
          const dx = col - cx
          const dy = row - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > radius) continue
          const idx = row * gridCols + col
          const cell = charGrid[idx]
          if (!cell) continue
          const a = 0.1 + (1 - dist / (radius + 0.001)) * 0.2
          cell.alpha = Math.min(0.35, Math.max(cell.alpha, a))
        }
      }
    }

    function renderChars(dt: number) {
      if (!charCtx || !charCanvas.width) return
      charCtx.clearRect(0, 0, charCanvas.width, charCanvas.height)
      charCtx.textAlign = 'center'
      charCtx.textBaseline = 'middle'
      const fontSize = Math.floor(CELL_SIZE * 0.9)
      charCtx.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
      charCtx.shadowBlur = 0

      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const idx = row * gridCols + col
          const cell = charGrid[idx]
          if (!cell) continue
          cell.alpha = Math.max(0, cell.alpha - dt * ALPHA_DECAY_RATE)
          if (cell.alpha <= 0.01) continue
          const x = col * CELL_SIZE + CELL_SIZE * 0.5
          const y = row * CELL_SIZE + CELL_SIZE * 0.54
          charCtx.fillStyle = `rgba(${CHAR_COLOR}, ${cell.alpha})`
          charCtx.fillText(cell.char, x, y)
        }
      }
    }

    // ============================================================
    // WebGL 流体（Stable Fluids 1999）
    // ============================================================
    function getWebGLContext(canvas: HTMLCanvasElement) {
      const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
      let gl: any = canvas.getContext('webgl2', params)
      const isWebGL2 = !!gl
      if (!isWebGL2) {
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params)
      }
      if (!gl) return null

      let halfFloat: any, halfFloatLinear: any
      if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float')
        halfFloatLinear = gl.getExtension('OES_texture_float_linear')
      } else {
        halfFloat = gl.getExtension('OES_texture_half_float')
        halfFloatLinear = gl.getExtension('OES_texture_half_float_linear')
      }

      gl.clearColor(0, 0, 0, 1)
      const halfFloatType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES)

      let formatRGBA: any, formatRG: any, formatR: any
      if (isWebGL2) {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatType)
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatType)
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatType)
      } else {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatType)
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatType)
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatType)
      }

      return {
        gl,
        ext: { formatRGBA, formatRG, formatR, halfFloatTexType: halfFloatType, supportLinearFiltering: halfFloatLinear },
      }
    }

    function checkFramebufferSupport(gl: any, internalFormat: any, format: any, type: any) {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)
      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    }

    function getSupportedFormat(gl: any, internalFormat: any, format: any, type: any): any {
      if (!checkFramebufferSupport(gl, internalFormat, format, type)) {
        switch (internalFormat) {
          case gl.R16F: return getSupportedFormat(gl, gl.RG16F, gl.RG, type)
          case gl.RG16F: return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type)
          default: return null
        }
      }
      return { internalFormat, format }
    }

    function compileShader(gl: any, type: any, source: string, keywords?: string[]) {
      let prefix = ''
      if (keywords) keywords.forEach(k => { prefix += '#define ' + k + '\n' })
      const shader = gl.createShader(type)
      gl.shaderSource(shader, prefix + source)
      gl.compileShader(shader)
      return shader
    }

    function createProgram(gl: any, vertShader: any, fragShader: any) {
      const prog = gl.createProgram()
      gl.attachShader(prog, vertShader)
      gl.attachShader(prog, fragShader)
      gl.linkProgram(prog)
      return prog
    }

    function getUniforms(gl: any, program: any) {
      const uniforms: Record<string, any> = {}
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
      for (let i = 0; i < count; i++) {
        const name = gl.getActiveUniform(program, i).name
        uniforms[name] = gl.getUniformLocation(program, name)
      }
      return uniforms
    }

    class Program {
      gl: any
      program: any
      uniforms: Record<string, any>
      constructor(gl: any, vertShader: any, fragShader: any) {
        this.gl = gl
        this.program = createProgram(gl, vertShader, fragShader)
        this.uniforms = getUniforms(gl, this.program)
      }
      bind() { this.gl.useProgram(this.program) }
    }

    class MultiProgram {
      gl: any
      vertexShader: any
      fragmentShaderSource: string
      programs: Record<number, any>
      activeProgram: any
      uniforms: Record<string, any>
      constructor(gl: any, vertShader: any, fragSource: string) {
        this.gl = gl
        this.vertexShader = vertShader
        this.fragmentShaderSource = fragSource
        this.programs = {}
        this.activeProgram = null
        this.uniforms = {}
      }
      setKeywords(keywords: string[]) {
        let key = 0
        for (let i = 0; i < keywords.length; i++) {
          let h = 0
          for (let j = 0; j < keywords[i].length; j++) {
            h = (h << 5) - h + keywords[i].charCodeAt(j)
            h |= 0
          }
          key += h
        }
        if (!this.programs[key]) {
          const frag = compileShader(this.gl, this.gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords)
          this.programs[key] = createProgram(this.gl, this.vertexShader, frag)
        }
        if (this.programs[key] !== this.activeProgram) {
          this.uniforms = getUniforms(this.gl, this.programs[key])
          this.activeProgram = this.programs[key]
        }
      }
      bind() { this.gl.useProgram(this.activeProgram) }
    }

    // GLSL 着色器源码
    const baseVertexShader = `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL, vR, vT, vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `

    const copyShaderSrc = `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      void main () { gl_FragColor = texture2D(uTexture, vUv); }
    `

    const clearShaderSrc = `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
    `

    const displayShaderSrc = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL, vR, vT, vB;
      uniform sampler2D uTexture;
      uniform vec2 texelSize;
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        #ifdef SHADING
          vec3 lc = texture2D(uTexture, vL).rgb;
          vec3 rc = texture2D(uTexture, vR).rgb;
          vec3 tc = texture2D(uTexture, vT).rgb;
          vec3 bc = texture2D(uTexture, vB).rgb;
          float dx = length(rc) - length(lc);
          float dy = length(tc) - length(bc);
          vec3 n = normalize(vec3(dx, dy, length(texelSize)));
          vec3 l = vec3(0.0, 0.0, 1.0);
          float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
          c *= diffuse;
        #endif
        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
      }
    `

    const splatShaderSrc = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `

    const advectionShaderSrc = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform vec2 dyeTexelSize;
      uniform float dt;
      uniform float dissipation;
      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
      }
      void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
      }
    `

    const divergenceShaderSrc = `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x;
        if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y;
        if (vB.y < 0.0) B = -C.y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `

    const curlShaderSrc = `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `

    const vorticityShaderSrc = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `

    const pressureShaderSrc = `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL, vR, vT, vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `

    const gradientSubtractShaderSrc = `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL, vR, vT, vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `

    // ============================================================
    // WebGL 初始化
    // ============================================================
    const webGLContext = getWebGLContext(fluidCanvas)
    if (!webGLContext) {
      console.warn('SplashCursor: WebGL not supported, falling back to static background')
      return
    }
    const { gl, ext } = webGLContext

    if (!ext.supportLinearFiltering) {
      CONFIG.DYE_RESOLUTION = 256
      CONFIG.SHADING = false
    }

    const baseVert = compileShader(gl, gl.VERTEX_SHADER, baseVertexShader)
    const copyFrag = compileShader(gl, gl.FRAGMENT_SHADER, copyShaderSrc)
    const clearFrag = compileShader(gl, gl.FRAGMENT_SHADER, clearShaderSrc)
    const splatFrag = compileShader(gl, gl.FRAGMENT_SHADER, splatShaderSrc)
    const advectionFrag = compileShader(gl, gl.FRAGMENT_SHADER, advectionShaderSrc,
      ext.supportLinearFiltering ? null : ['MANUAL_FILTERING'])
    const divergenceFrag = compileShader(gl, gl.FRAGMENT_SHADER, divergenceShaderSrc)
    const curlFrag = compileShader(gl, gl.FRAGMENT_SHADER, curlShaderSrc)
    const vorticityFrag = compileShader(gl, gl.FRAGMENT_SHADER, vorticityShaderSrc)
    const pressureFrag = compileShader(gl, gl.FRAGMENT_SHADER, pressureShaderSrc)
    const gradSubFrag = compileShader(gl, gl.FRAGMENT_SHADER, gradientSubtractShaderSrc)

    const copyProgram = new Program(gl, baseVert, copyFrag)
    const clearProgram = new Program(gl, baseVert, clearFrag)
    const splatProgram = new Program(gl, baseVert, splatFrag)
    const advectionProgram = new Program(gl, baseVert, advectionFrag)
    const divergenceProgram = new Program(gl, baseVert, divergenceFrag)
    const curlProgram = new Program(gl, baseVert, curlFrag)
    const vorticityProgram = new Program(gl, baseVert, vorticityFrag)
    const pressureProgram = new Program(gl, baseVert, pressureFrag)
    const gradSubProgram = new Program(gl, baseVert, gradSubFrag)
    const displayProgram = new MultiProgram(gl, baseVert, displayShaderSrc)

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(0)

    function blit(target: any, clear?: boolean) {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      } else {
        gl.viewport(0, 0, target.width, target.height)
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
      }
      if (clear) {
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
    }

    function createFBO(w: number, h: number, internalFormat: any, format: any, type: any, filter: any) {
      gl.activeTexture(gl.TEXTURE0)
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)
      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.viewport(0, 0, w, h)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return {
        texture: tex, fbo, width: w, height: h,
        texelSizeX: 1.0 / w, texelSizeY: 1.0 / h,
        attach(id: number) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id },
      }
    }

    function createDoubleFBO(w: number, h: number, internalFormat: any, format: any, type: any, filter: any) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, filter)
      let fbo2 = createFBO(w, h, internalFormat, format, type, filter)
      return {
        width: w, height: h,
        texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
        get read() { return fbo1 }, set read(v: any) { fbo1 = v },
        get write() { return fbo2 }, set write(v: any) { fbo2 = v },
        swap() { const t = fbo1; fbo1 = fbo2; fbo2 = t },
      }
    }

    function resizeFBO(target: any, w: number, h: number, internalFormat: any, format: any, type: any, filter: any) {
      const newFBO = createFBO(w, h, internalFormat, format, type, filter)
      copyProgram.bind()
      gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
      blit(newFBO)
      return newFBO
    }

    function resizeDoubleFBO(target: any, w: number, h: number, internalFormat: any, format: any, type: any, filter: any) {
      if (target.width === w && target.height === h) return target
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, filter)
      target.write = createFBO(w, h, internalFormat, format, type, filter)
      target.width = w; target.height = h
      target.texelSizeX = 1.0 / w; target.texelSizeY = 1.0 / h
      return target
    }

    function getResolution(resolution: number) {
      let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio
      const min = Math.round(resolution)
      const max = Math.round(resolution * aspectRatio)
      return gl.drawingBufferWidth > gl.drawingBufferHeight
        ? { width: max, height: min }
        : { width: min, height: max }
    }

    let dye: any, velocity: any, divergence: any, curl: any, pressure: any

    function initFramebuffers() {
      const simRes = getResolution(CONFIG.SIM_RESOLUTION)
      const dyeRes = getResolution(CONFIG.DYE_RESOLUTION)
      const texType = ext.halfFloatTexType
      const rgba = ext.formatRGBA
      const rg = ext.formatRG
      const r = ext.formatR
      const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST

      gl.disable(gl.BLEND)

      if (dye) dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
      else dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)

      if (velocity) velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
      else velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)

      divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
      curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
      pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
    }

    function updateKeywords() {
      const kw: string[] = []
      if (CONFIG.SHADING) kw.push('SHADING')
      displayProgram.setKeywords(kw)
    }

    // ============================================================
    // 鼠标 / 触摸交互
    // ============================================================
    class Pointer {
      id = -1
      texcoordX = 0; texcoordY = 0
      prevTexcoordX = 0; prevTexcoordY = 0
      deltaX = 0; deltaY = 0
      down = false; moved = false
      color: number[] = [0, 0, 0]
    }

    const pointers = [new Pointer()]

    function scaleByWidth(val: number) {
      const ar = fluidCanvas.width / fluidCanvas.height
      return ar > 1 ? val * ar : val
    }
    function scaleByWidthInv(val: number) {
      const ar = fluidCanvas.width / fluidCanvas.height
      return ar < 1 ? val * ar : val
    }
    function scaleByHeightInv(val: number) {
      const ar = fluidCanvas.width / fluidCanvas.height
      return ar > 1 ? val / ar : val
    }

    function generateColor() {
      const pal = paletteRef.current
      const c = pal[Math.floor(Math.random() * pal.length)]
      const v = 0.08
      return {
        r: Math.min(1, Math.max(0, c.r * (0.22 + Math.random() * v))),
        g: Math.min(1, Math.max(0, c.g * (0.22 + Math.random() * v))),
        b: Math.min(1, Math.max(0, c.b * (0.22 + Math.random() * v))),
      }
    }

    function pointerDown(p: Pointer, id: number, posX: number, posY: number) {
      p.id = id; p.down = true; p.moved = false
      p.texcoordX = posX / fluidCanvas.width
      p.texcoordY = 1.0 - posY / fluidCanvas.height
      p.prevTexcoordX = p.texcoordX; p.prevTexcoordY = p.texcoordY
      p.deltaX = 0; p.deltaY = 0
      const c = generateColor()
      p.color = [c.r, c.g, c.b]
    }

    function pointerMove(p: Pointer, posX: number, posY: number, color: any) {
      p.prevTexcoordX = p.texcoordX; p.prevTexcoordY = p.texcoordY
      p.texcoordX = posX / fluidCanvas.width
      p.texcoordY = 1.0 - posY / fluidCanvas.height
      p.deltaX = scaleByWidthInv(p.texcoordX - p.prevTexcoordX)
      p.deltaY = scaleByHeightInv(p.texcoordY - p.prevTexcoordY)
      p.moved = Math.abs(p.deltaX) > 0 || Math.abs(p.deltaY) > 0
      p.color = [color.r, color.g, color.b]
    }

    function pointerUp(p: Pointer) { p.down = false }

    function splat(x: number, y: number, dx: number, dy: number, color: number[]) {
      splatProgram.bind()
      gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
      gl.uniform1f(splatProgram.uniforms.aspectRatio, fluidCanvas.width / fluidCanvas.height)
      gl.uniform2f(splatProgram.uniforms.point, x, y)
      gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0)
      gl.uniform1f(splatProgram.uniforms.radius, scaleByWidth(CONFIG.SPLAT_RADIUS / 100))
      blit(velocity.write)
      velocity.swap()

      gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0))
      gl.uniform3f(splatProgram.uniforms.color, color[0], color[1], color[2])
      blit(dye.write)
      dye.swap()
    }

    function splatPointer(p: Pointer) {
      const dx = p.deltaX * CONFIG.SPLAT_FORCE
      const dy = p.deltaY * CONFIG.SPLAT_FORCE
      splat(p.texcoordX, p.texcoordY, dx, dy, p.color)
    }

    function step(dt: number) {
      gl.disable(gl.BLEND)

      curlProgram.bind()
      gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
      blit(curl)

      vorticityProgram.bind()
      gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
      gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1))
      gl.uniform1f(vorticityProgram.uniforms.curl, CONFIG.CURL)
      gl.uniform1f(vorticityProgram.uniforms.dt, dt)
      blit(velocity.write)
      velocity.swap()

      divergenceProgram.bind()
      gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
      blit(divergence)

      clearProgram.bind()
      gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
      gl.uniform1f(clearProgram.uniforms.value, CONFIG.PRESSURE)
      blit(pressure.write)
      pressure.swap()

      pressureProgram.bind()
      gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0))
      for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
        blit(pressure.write)
        pressure.swap()
      }

      gradSubProgram.bind()
      gl.uniform2f(gradSubProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      gl.uniform1i(gradSubProgram.uniforms.uPressure, pressure.read.attach(0))
      gl.uniform1i(gradSubProgram.uniforms.uVelocity, velocity.read.attach(1))
      blit(velocity.write)
      velocity.swap()

      advectionProgram.bind()
      gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY)
      }
      const velocityId = velocity.read.attach(0)
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
      gl.uniform1i(advectionProgram.uniforms.uSource, velocityId)
      gl.uniform1f(advectionProgram.uniforms.dt, dt)
      gl.uniform1f(advectionProgram.uniforms.dissipation, CONFIG.VELOCITY_DISSIPATION)
      blit(velocity.write)
      velocity.swap()

      if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY)
      }
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
      gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1))
      gl.uniform1f(advectionProgram.uniforms.dissipation, CONFIG.DENSITY_DISSIPATION)
      blit(dye.write)
      dye.swap()
    }

    function pixelSize(val: number) {
      return Math.floor(val * (window.devicePixelRatio || 1))
    }

    function resizeCanvas() {
      const w = pixelSize(fluidCanvas.clientWidth)
      const h = pixelSize(fluidCanvas.clientHeight)
      if (fluidCanvas.width !== w || fluidCanvas.height !== h) {
        fluidCanvas.width = w
        fluidCanvas.height = h
        resizeCharCanvas()
        return true
      }
      return false
    }

    // ============================================================
    // 事件监听
    // ============================================================
    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const scaleX = fluidCanvas.width / rect.width
      const scaleY = fluidCanvas.height / rect.height
      const px = (e.clientX - rect.left) * scaleX
      const py = (e.clientY - rect.top) * scaleY

      const p = pointers[0]
      if (!p.down) pointerDown(p, -1, px, py)
      const color = generateColor()
      pointerMove(p, px, py, color)

      const speed = Math.sqrt(p.deltaX * p.deltaX + p.deltaY * p.deltaY)
      activateCharsClose(px, py, speed * 50 + 1)
      activateCharsWide(px, py, speed * 50 + 1.2)
    }

    const onMouseLeave = () => {
      pointerUp(pointers[0])
    }

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const scaleX = fluidCanvas.width / rect.width
      const scaleY = fluidCanvas.height / rect.height
      const touches = e.targetTouches
      while (pointers.length > touches.length) pointers.pop()
      while (pointers.length < touches.length) pointers.push(new Pointer())
      for (let i = 0; i < touches.length; i++) {
        const px = (touches[i].clientX - rect.left) * scaleX
        const py = (touches[i].clientY - rect.top) * scaleY
        pointerDown(pointers[i], touches[i].identifier, px, py)
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const scaleX = fluidCanvas.width / rect.width
      const scaleY = fluidCanvas.height / rect.height
      const touches = e.targetTouches
      for (let i = 0; i < touches.length; i++) {
        const p = pointers[i]
        if (!p) continue
        const px = (touches[i].clientX - rect.left) * scaleX
        const py = (touches[i].clientY - rect.top) * scaleY
        const color = generateColor()
        pointerMove(p, px, py, color)
        activateCharsClose(px, py, 1)
        activateCharsWide(px, py, 1.2)
      }
    }

    const onTouchEnd = () => {
      for (const p of pointers) pointerUp(p)
    }

    const onResize = () => {
      resizeCanvas()
      initFramebuffers()
    }

    container.addEventListener('mousemove', onMouseMove)
    container.addEventListener('mouseleave', onMouseLeave)
    container.addEventListener('touchstart', onTouchStart, { passive: false })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    window.addEventListener('resize', onResize)

    // ============================================================
    // 主渲染循环
    // ============================================================
    let lastTime = 0
    let rafId = 0
    let mounted = true

    function mainLoop(time: number) {
      if (!mounted) return
      const dt = Math.min((time - lastTime) / 1000, 0.016666)
      lastTime = time

      if (resizeCanvas()) initFramebuffers()

      for (const p of pointers) {
        if (p.moved) {
          p.moved = false
          splatPointer(p)
        }
      }

      step(dt)

      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      displayProgram.bind()
      gl.uniform2f(displayProgram.uniforms.texelSize, 1.0 / gl.drawingBufferWidth, 1.0 / gl.drawingBufferHeight)
      gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0))
      blit(null)

      renderChars(dt)

      rafId = requestAnimationFrame(mainLoop)
    }

    initFramebuffers()
    updateKeywords()
    resizeCharCanvas()
    rafId = requestAnimationFrame(mainLoop)

    // 清理
    return () => {
      mounted = false
      cancelAnimationFrame(rafId)
      container.removeEventListener('mousemove', onMouseMove)
      container.removeEventListener('mouseleave', onMouseLeave)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', onResize)
      // 浏览器卸载 canvas 时会自动释放 WebGL 资源，不需要手动 deleteBuffer/Texture
    }
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#101010',
      }}
    >
      <canvas
        ref={fluidRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={charsRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
