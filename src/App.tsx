import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'

type Tool = 'pen' | 'eraser' | 'picker' | 'fill'
type Point = { x: number; y: number; pressure: number }
type Stroke = {
  points: Point[]
  tool: 'pen' | 'eraser'
  size: number
  opacity: number
}
type Layer = {
  id: number
  name: string
  visible: boolean
  opacity: number
  strokes: Stroke[]
}

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: 'pen', label: 'Pen', icon: '✎' },
  { id: 'eraser', label: 'Eraser', icon: '⌫' },
  { id: 'picker', label: 'Picker', icon: '◉' },
  { id: 'fill', label: 'Fill', icon: '◒' },
]

const cloneLayers = (value: Layer[]): Layer[] =>
  value.map(layer => ({
    ...layer,
    strokes: layer.strokes.map(stroke => ({
      ...stroke,
      points: stroke.points.map(point => ({ ...point })),
    })),
  }))

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
  const [layers, setLayers] = useState<Layer[]>([
    { id: 1, name: 'Layer 1', visible: true, opacity: 1, strokes: [] },
  ])
  const [activeLayerId, setActiveLayerId] = useState(1)
  const [showLayers, setShowLayers] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  const layersRef = useRef(layers)
  const history = useRef<{ past: Layer[][]; future: Layer[][] }>({ past: [], future: [] })
  const drawing = useRef(false)
  const currentStroke = useRef<Stroke | null>(null)
  const last = useRef({ x: 0, y: 0 })
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextLayerId = useRef(2)

  const syncLayers = (next: Layer[]) => {
    layersRef.current = next
    setLayers(next)
  }

  const commit = (next: Layer[]) => {
    history.current.past.push(cloneLayers(layersRef.current))
    history.current.future = []
    syncLayers(next)
    setHistoryCount(history.current.past.length)
    setRedoCount(0)
  }

  const undo = () => {
    const previous = history.current.past.pop()
    if (!previous) return
    history.current.future.push(cloneLayers(layersRef.current))
    syncLayers(previous)
    setHistoryCount(history.current.past.length)
    setRedoCount(history.current.future.length)
  }

  const redo = () => {
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(cloneLayers(layersRef.current))
    syncLayers(next)
    setHistoryCount(history.current.past.length)
    setRedoCount(history.current.future.length)
  }

  const pressureWidth = (base: number, pressure: number) =>
    base * (0.35 + Math.min(1, Math.max(0, pressure || 0.5)) * 0.95)

  const drawStroke = (
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    layerOpacity = 1,
  ) => {
    if (!stroke.points.length) return

    ctx.save()
    ctx.globalAlpha = stroke.opacity * layerOpacity
    ctx.globalCompositeOperation =
      stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#f5f5f5'
    ctx.fillStyle = '#f5f5f5'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (stroke.points.length === 1) {
      const p = stroke.points[0]
      const radius = pressureWidth(stroke.size, p.pressure) / 2
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    for (let i = 1; i < stroke.points.length; i += 1) {
      const a = stroke.points[i - 1]
      const b = stroke.points[i]
      ctx.lineWidth = pressureWidth(
        stroke.size,
        (a.pressure + b.pressure) / 2,
      )
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    ctx.restore()
  }

  const render = (preview: Stroke | null = null) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const dpr = Math.max(1, window.devicePixelRatio || 1)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    for (const layer of layersRef.current) {
      if (!layer.visible) continue
      for (const stroke of layer.strokes) {
        drawStroke(ctx, stroke, layer.opacity)
      }
    }

    if (preview) {
      drawStroke(ctx, preview, 1)
    }
  }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      render()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    render()
  }, [layers])

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
    drawing.current = false
    currentStroke.current = null
    clearLongPress()

    longPress.current = setTimeout(() => {
      drawing.current = false
      currentStroke.current = null
      setMenu(p)
    }, 480)
  }

  const beginStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    clearLongPress()
    drawing.current = true
    currentStroke.current = {
      points: [{ ...point(e), pressure: e.pressure || 0.5 }],
      tool: tool === 'eraser' ? 'eraser' : 'pen',
      size,
      opacity,
    }
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = point(e)

    if (!drawing.current) {
      const dx = p.x - last.current.x
      const dy = p.y - last.current.y
      if (Math.hypot(dx, dy) < 4) return
      if (tool !== 'pen' && tool !== 'eraser') return
      beginStroke(e)
    }

    clearLongPress()
    const stroke = currentStroke.current
    if (!stroke) return

    stroke.points.push({ ...p, pressure: e.pressure || 0.5 })
    last.current = p
    render(stroke)
  }

  const end = () => {
    clearLongPress()
    if (!drawing.current || !currentStroke.current) {
      drawing.current = false
      return
    }

    const finished = currentStroke.current
    const next = layersRef.current.map(layer =>
      layer.id === activeLayerId
        ? { ...layer, strokes: [...layer.strokes, finished] }
        : layer,
    )

    drawing.current = false
    currentStroke.current = null
    commit(next)
  }

  const addLayer = () => {
    const id = nextLayerId.current++
    const next = [
      ...layersRef.current,
      { id, name: `Layer ${id}`, visible: true, opacity: 1, strokes: [] },
    ]
    commit(next)
    setActiveLayerId(id)
  }

  const deleteLayer = () => {
    if (layersRef.current.length === 1) {
      clearCanvas()
      return
    }

    const index = layersRef.current.findIndex(layer => layer.id === activeLayerId)
    const next = layersRef.current.filter(layer => layer.id !== activeLayerId)
    commit(next)
    setActiveLayerId(next[Math.max(0, index - 1)]?.id ?? next[0].id)
  }

  const toggleLayer = (id: number) => {
    commit(
      layersRef.current.map(layer =>
        layer.id === id ? { ...layer, visible: !layer.visible } : layer,
      ),
    )
  }

  const clearCanvas = () => {
    const next = layersRef.current.map(layer =>
      layer.id === activeLayerId ? { ...layer, strokes: [] } : layer,
    )
    commit(next)
  }

  const importImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setReference(String(reader.result))
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span>καλλιτέχνις</span>
          <small>eureka / 0.2</small>
        </div>
        <div className="actions">
          <button className="icon-btn" onClick={undo} disabled={!historyCount} title="Undo">↶</button>
          <button className="icon-btn" onClick={redo} disabled={!redoCount} title="Redo">↷</button>
          <label className="icon-btn" title="Import reference image">＋</label>
          <input className="file-input" type="file" accept="image/*" onChange={importImage} />
          <button className="icon-btn" onClick={clearCanvas} title="Clear active layer">⌫</button>
        </div>
      </header>

      <section className="workspace" ref={wrapRef}>
        {reference && (
          <div className={`reference ${referenceLocked ? 'locked' : ''}`} style={{ opacity: referenceOpacity }}>
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
            onPointerDown={e => e.stopPropagation()}
          >
            {tools.map((item, i) => {
              const angles = [-145, -90, -35, 20]
              const radius = 76
              const a = angles[i] * Math.PI / 180
              return (
                <button
                  key={item.id}
                  className={`tool ${tool === item.id ? 'active' : ''}`}
                  style={{
                    transform: `translate(calc(-50% + ${Math.cos(a) * radius}px), calc(-50% + ${Math.sin(a) * radius}px))`,
                  }}
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

      {showLayers && (
        <aside className="layers-panel">
          <div className="layers-head">
            <strong>Layers</strong>
            <button onClick={addLayer}>＋ Layer</button>
          </div>
          <div className="layer-list">
            {[...layers].reverse().map(layer => (
              <div
                key={layer.id}
                className={`layer-row ${layer.id === activeLayerId ? 'selected' : ''}`}
                onClick={() => setActiveLayerId(layer.id)}
              >
                <button
                  className="layer-eye"
                  onClick={e => { e.stopPropagation(); toggleLayer(layer.id) }}
                  title="Toggle visibility"
                >
                  {layer.visible ? '◉' : '○'}
                </button>
                <span>{layer.name}</span>
                <small>{layer.strokes.length}</small>
              </div>
            ))}
          </div>
          <button className="delete-layer" onClick={deleteLayer}>Delete active layer</button>
        </aside>
      )}

      {reference && (
        <aside className="reference-panel">
          <strong>Reference</strong>
          <label>Opacity <input type="range" min="0.05" max="1" step="0.05" value={referenceOpacity} onChange={e => setReferenceOpacity(Number(e.target.value))} /></label>
          <button onClick={() => setReferenceLocked(v => !v)}>{referenceLocked ? '🔒 Locked' : '🔓 Unlocked'}</button>
          <button onClick={() => setReference(null)}>Remove</button>
        </aside>
      )}

      <footer className="controls">
        <button className="control-button" onClick={() => setShowLayers(v => !v)}>layers</button>
        <span>{tool}</span>
        <label>size <input type="range" min="1" max="40" value={size} onChange={e => setSize(Number(e.target.value))} /></label>
        <label>opacity <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label>
        <span className="pressure">pressure</span>
        <span className="hint">long-press canvas</span>
      </footer>
    </main>
  )
}
