import { lazy, Suspense, useCallback, useState } from 'react'
import { Overlay } from './ui/Overlay'

// the 3D world (three, physics, shaders) streams in behind the veil
const Experience = lazy(() => import('./scene/Experience').then((m) => ({ default: m.Experience })))

export default function App() {
  const [ready, setReady] = useState(false)
  const onReady = useCallback(() => setReady(true), [])

  return (
    <main className="app">
      <Suspense fallback={null}>
        <Experience onReady={onReady} />
      </Suspense>
      <Overlay visible={ready} />
      <div className={`veil${ready ? ' veil--lifted' : ''}`} aria-hidden="true">
        <span className="veil__ember" />
      </div>
    </main>
  )
}
