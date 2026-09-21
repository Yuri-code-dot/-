import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'

type Tool = 'pen' | 'eraser' | 'picker' | 'fill'

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: 'pen', label: 'Pen', icon: '✎' },
  { id: 'eraser', label: 'Eraser', icon: '⌫' },
  { id: 'picker', label: 'Picker', icon: '◉' },
  { id: 'fill', label: 'Fill', icon: '◒' },
]

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState(5)
  const [opacity, setOpacity] = useState(1)
  const [reference, setReference] = useState<string | null>(null)
  const [referenceOpacity, setReferenceOpacity] = useState(0.35)
  const [referenceLocked, setReferenceLocked] = useState(false)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawing = useRef(false)
  const last = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const old = canvas.width > 0 ? canvas.toDataURL() : null
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (old && rect.width > 0 && rect.height > 0) {
        const img = new Image()
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height)
        img.src = old
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const clearLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current)
    longPress.current = null
  }

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = point(e)
    last.current = p
    clearLongPress()
    longPress.current = setTimeout(() => {
      drawing.current = false
      setMenu(p)
    }, 480)

    if (tool === 'pen' || tool === 'eraser') {
      drawing.current = true
      const ctx = e.currentTarget.getContext('2d')
      if (ctx) {
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
      }
    }
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    clearLongPress()
    const p = point(e)
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return

    ctx.globalAlpha = opacity
    ctx.lineWidth = size
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#f5f5f5'
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  const end = (e: PointerEvent<HTMLCanvasElement>) => {
    clearLongPress()
    drawing.current = false
    const ctx = e.currentTarget.getContext('2d')
    if (ctx) ctx.globalCompositeOperation = 'source-over'
  }

  const importImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setReference(String(reader.result))
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const clearCanvas = () => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.clientWidth, c.clientHeight)
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span>καλλιτέχνις</span><small>eureka / 0.1</small></div>
        <div className="actions">
          <label className="icon-btn" title="Import reference image">＋</label>
          <input className="file-input" type="file" accept="image/*" onChange={importImage} />
          <button className="icon-btn" onClick={clearCanvas} title="Clear drawing">⌫</button>
        </div>
      </header>

      <section className="workspace" ref={wrapRef}>
        {reference && (
          <div className="reference" style={{ opacity: referenceOpacity }}>
            <img src={reference} alt="Reference" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="canvas"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />

        {menu && (
          <div
            className="tool-menu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {tools.map((item, i) => {
              const angles = [-145, -90, -35, 20]
              const radius = 76
              const a = angles[i] * Math.PI / 180
              return (
                <button
                  key={item.id}
                  className={`tool ${tool === item.id ? 'active' : ''}`}
                  style={{ transform: `translate(calc(-50% + ${Math.cos(a) * radius}px), calc(-50% + ${Math.sin(a) * radius}px))` }}
                  onClick={() => { setTool(item.id); setMenu(null) }}
                  title={item.label}
                >
                  <b>{item.icon}</b><span>{item.label}</span>
                </button>
              )
            })}
            <button className="menu-center" onClick={() => setMenu(null)}>×</button>
          </div>
        )}
      </section>

      {reference && (
        <aside className="reference-panel">
          <strong>Reference</strong>
          <label>Opacity <input type="range" min="0.05" max="1" step="0.05" value={referenceOpacity} onChange={e => setReferenceOpacity(Number(e.target.value))} /></label>
          <button onClick={() => setReferenceLocked(v => !v)}>{referenceLocked ? '🔒 Locked' : '🔓 Unlocked'}</button>
          <button onClick={() => setReference(null)}>Remove</button>
        </aside>
      )}

      <footer className="controls">
        <span>{tool}</span>
        <label>size <input type="range" min="1" max="40" value={size} onChange={e => setSize(Number(e.target.value))} /></label>
        <label>opacity <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label>
        <span className="hint">long-press canvas</span>
      </footer>
    </main>
  )
}