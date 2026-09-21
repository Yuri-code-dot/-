import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'

type Tool = 'pen' | 'eraser' | 'picker' | 'fill'
type Theme = 'dark' | 'light'
type Point = { x: number; y: number; pressure: number }
type Stroke = {
  points: Point[]
  tool: 'pen' | 'eraser'
  size: number
  opacity: number
  color?: string
}
type Layer = {
  id: number
  name: string
  visible: boolean
  opacity: number
  strokes: Stroke[]
}
type Reference = {
  src: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
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
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [tool, setTool] = useState<Tool>('pen')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState(5)
  const [opacity, setOpacity] = useState(1)
  const [theme, setTheme] = useState<Theme>('dark')
  const [reference, setReference] = useState<Reference | null>(null)
  const [referenceOpacity, setReferenceOpacity] = useState(0.35)
  const [referenceLocked, setReferenceLocked] = useState(false)
  const [referenceEditing, setReferenceEditing] = useState(false)
  const [layers, setLayers] = useState<Layer[]>([
    { id: 1, name: 'Layer 1', visible: true, opacity: 1, strokes: [] },
  ])
  const [activeLayerId, setActiveLayerId] = useState(1)
  const [showLayers, setShowLayers] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  const layersRef = useRef(layers)
  const history = useRef<{ past: Layer[][]; future: Layer[][] }>({ past: [], future: [] })
  const drawing = useRef(false)
  const currentStroke = useRef<Stroke | null>(null)
  const last = useRef({ x: 0, y: 0 })
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextLayerId = useRef(2)
  const transformPointer = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const resizePointer = useRef<{ id: number; startX: number; startY: number; width: number; height: number; x: number; y: number } | null>(null)
  const rotatePointer = useRef<{ id: number; centerX: number; centerY: number; startAngle: number; rotation: number } | null>(null)

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

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke, layerOpacity = 1) => {
    if (!stroke.points.length) return
    ctx.save()
    ctx.globalAlpha = stroke.opacity * layerOpacity
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.color ?? (theme === 'dark' ? '#f5f5f5' : '#18181b')
    ctx.fillStyle = ctx.strokeStyle
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (stroke.points.length === 1) {
      const p = stroke.points[0]
      ctx.beginPath()
      ctx.arc(p.x, p.y, pressureWidth(stroke.size, p.pressure) / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    for (let i = 1; i < stroke.points.length; i += 1) {
      const a = stroke.points[i - 1]
      const b = stroke.points[i]
      ctx.lineWidth = pressureWidth(stroke.size, (a.pressure + b.pressure) / 2)
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
      for (const stroke of layer.strokes) drawStroke(ctx, stroke, layer.opacity)
    }
    if (preview) drawStroke(ctx, preview)
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

  useEffect(() => render(), [layers, theme])

  const canvasPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const clearLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current)
    longPress.current = null
  }

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    if (referenceEditing) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = canvasPoint(e)
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
      points: [{ ...canvasPoint(e), pressure: e.pressure || 0.5 }],
      tool: tool === 'eraser' ? 'eraser' : 'pen',
      size,
      opacity,
      color: theme === 'dark' ? '#f5f5f5' : '#18181b',
    }
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (referenceEditing) return
    const p = canvasPoint(e)

    if (!drawing.current) {
      if (Math.hypot(p.x - last.current.x, p.y - last.current.y) < 4) return
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
      layer.id === activeLayerId ? { ...layer, strokes: [...layer.strokes, finished] } : layer,
    )
    drawing.current = false
    currentStroke.current = null
    commit(next)
  }

  const addLayer = () => {
    const id = nextLayerId.current++
    commit([...layersRef.current, { id, name: `Layer ${id}`, visible: true, opacity: 1, strokes: [] }])
    setActiveLayerId(id)
  }

  const deleteLayer = () => {
    if (layersRef.current.length === 1) return clearCanvas()
    const index = layersRef.current.findIndex(layer => layer.id === activeLayerId)
    const next = layersRef.current.filter(layer => layer.id !== activeLayerId)
    commit(next)
    setActiveLayerId(next[Math.max(0, index - 1)]?.id ?? next[0].id)
  }

  const toggleLayer = (id: number) => {
    commit(layersRef.current.map(layer => layer.id === id ? { ...layer, visible: !layer.visible } : layer))
  }

  const clearCanvas = () => {
    commit(layersRef.current.map(layer => layer.id === activeLayerId ? { ...layer, strokes: [] } : layer))
  }

  const importImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      setReference({
        src,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
      })
      setReferenceLocked(false)
      setReferenceEditing(true)

      const img = new Image()
      img.onload = () => {
        const wrap = wrapRef.current
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        const maxW = rect.width * 0.72
        const maxH = rect.height * 0.62
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
        const width = Math.max(80, img.naturalWidth * scale)
        const height = Math.max(80, img.naturalHeight * scale)
        setReference({ src, x: (rect.width - width) / 2, y: (rect.height - height) / 2, width, height, rotation: 0 })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const beginImageMove = (e: PointerEvent<HTMLDivElement>) => {
    if (referenceLocked || !reference) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    transformPointer.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: reference.x,
      originY: reference.y,
    }
  }

  const moveImage = (e: PointerEvent<HTMLDivElement>) => {
    const t = transformPointer.current
    if (!t || !reference || t.id !== e.pointerId) return
    setReference(r => r ? { ...r, x: t.originX + e.clientX - t.startX, y: t.originY + e.clientY - t.startY } : r)
  }

  const endImageMove = (e: PointerEvent<HTMLDivElement>) => {
    if (transformPointer.current?.id === e.pointerId) transformPointer.current = null
  }

  const beginResize = (e: PointerEvent<HTMLButtonElement>) => {
    if (referenceLocked || !reference) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizePointer.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      width: reference.width,
      height: reference.height,
      x: reference.x,
      y: reference.y,
    }
  }

  const resizeImage = (e: PointerEvent<HTMLButtonElement>) => {
    const r = resizePointer.current
    if (!r || !reference || r.id !== e.pointerId) return
    const ratio = r.width / Math.max(1, r.height)
    const delta = (e.clientX - r.startX + e.clientY - r.startY) * 0.5
    const width = Math.max(70, r.width + delta)
    const height = Math.max(70, width / ratio)
    setReference(v => v ? { ...v, width, height, x: r.x, y: r.y } : v)
  }

  const endResize = (e: PointerEvent<HTMLButtonElement>) => {
    if (resizePointer.current?.id === e.pointerId) resizePointer.current = null
  }

  const beginRotate = (e: PointerEvent<HTMLButtonElement>) => {
    if (referenceLocked || !reference) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const centerX = reference.x + reference.width / 2
    const centerY = reference.y + reference.height / 2
    rotatePointer.current = {
      id: e.pointerId,
      centerX,
      centerY,
      startAngle: Math.atan2(e.clientY - centerY, e.clientX - centerX),
      rotation: reference.rotation,
    }
  }

  const rotateImage = (e: PointerEvent<HTMLButtonElement>) => {
    const r = rotatePointer.current
    if (!r || !reference || r.id !== e.pointerId) return
    const angle = Math.atan2(e.clientY - r.centerY, e.clientX - r.centerX)
    const degrees = (angle - r.startAngle) * 180 / Math.PI
    setReference(v => v ? { ...v, rotation: r.rotation + degrees } : v)
  }

  const endRotate = (e: PointerEvent<HTMLButtonElement>) => {
    if (rotatePointer.current?.id === e.pointerId) rotatePointer.current = null
  }

  return (
    <main className={`app ${theme}`}>
      <header className="topbar">
        <div className="brand">
          <span>καλλιτέχνις</span>
          <small>eureka / 0.3</small>
        </div>
        <div className="actions">
          <button className="icon-btn" onClick={undo} disabled={!historyCount} title="Undo">↶</button>
          <button className="icon-btn" onClick={redo} disabled={!redoCount} title="Redo">↷</button>
          <button className="icon-btn" onClick={() => imageInputRef.current?.click()} title="Import reference image">＋</button>
          <input ref={imageInputRef} className="file-input" type="file" accept="image/*" onChange={importImage} />
          <button className="icon-btn" onClick={clearCanvas} title="Clear active layer">⌫</button>
          <button className="icon-btn" onClick={() => setShowSettings(v => !v)} title="Settings">⚙</button>
        </div>
      </header>

      <section className="workspace" ref={wrapRef}>
        {reference && (
          <div
            className={`reference-object ${referenceLocked ? 'locked' : ''} ${referenceEditing ? 'editing' : ''}`}
            style={{
              left: reference.x,
              top: reference.y,
              width: reference.width,
              height: reference.height,
              transform: `rotate(${reference.rotation}deg)`,
              opacity: referenceOpacity,
            }}
            onPointerDown={beginImageMove}
            onPointerMove={moveImage}
            onPointerUp={endImageMove}
            onPointerCancel={endImageMove}
          >
            <img src={reference.src} alt="Reference" draggable={false} />
            {referenceEditing && !referenceLocked && (
              <>
                <button className="resize-handle" onPointerDown={beginResize} onPointerMove={resizeImage} onPointerUp={endResize} onPointerCancel={endResize} aria-label="Resize reference" />
                <button className="rotate-handle" onPointerDown={beginRotate} onPointerMove={rotateImage} onPointerUp={endRotate} onPointerCancel={endRotate}>↻</button>
                <div className="reference-tag">REFERENCE • MOVE / SCALE / ROTATE</div>
              </>
            )}
          </div>
        )}

        <canvas
          ref={canvasRef}
          className={`canvas ${referenceEditing ? 'drawing-paused' : ''}`}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />

        {menu && (
          <div className="tool-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()}>
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

      {showLayers && (
        <aside className="layers-panel">
          <div className="layers-head">
            <strong>Layers</strong>
            <button onClick={addLayer}>＋ Layer</button>
          </div>
          <div className="layer-list">
            {[...layers].reverse().map(layer => (
              <div key={layer.id} className={`layer-row ${layer.id === activeLayerId ? 'selected' : ''}`} onClick={() => setActiveLayerId(layer.id)}>
                <button className="layer-eye" onClick={e => { e.stopPropagation(); toggleLayer(layer.id) }} title="Toggle visibility">{layer.visible ? '◉' : '○'}</button>
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
          <div className="reference-title">
            <strong>Reference image</strong>
            <button onClick={() => setReferenceEditing(v => !v)}>{referenceEditing ? '✓ Done' : 'Edit'}</button>
          </div>
          <label>Opacity <input type="range" min="0.05" max="1" step="0.05" value={referenceOpacity} onChange={e => setReferenceOpacity(Number(e.target.value))} /></label>
          <button onClick={() => setReferenceLocked(v => !v)}>{referenceLocked ? '🔒 Locked' : '🔓 Unlock'}</button>
          <button onClick={() => { setReference(null); setReferenceEditing(false) }}>Remove</button>
        </aside>
      )}

      {showSettings && (
        <aside className="settings-panel">
          <strong>Appearance</strong>
          <div className="theme-row">
            <button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}>☾ Dark</button>
            <button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}>☼ Light</button>
          </div>
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
