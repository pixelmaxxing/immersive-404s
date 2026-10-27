import { useEffect, useRef, useState } from 'react'
import { HOME_URL } from '../config'
import { worldEvents } from '../world/events'
import { burnRadius, burnReach, burnRoughness } from '../world/finale'
import { hud } from './hud'

/** The headline turns over once the stone has broken. */
const HEADLINE_DELAY = 650
/** If the scene never finishes burning (a hidden tab, a lost GPU), go home anyway. */
const FALLBACK_LEAVE = 9000

/** Each piece of text flares and burns off as the burning edge reaches it. */
function burnOff(root: HTMLElement, origin: [number, number], duration: number) {
  const w = window.innerWidth
  const h = window.innerHeight
  const reach = burnReach(origin[0] / w, 1 - origin[1] / h, w / h)
  for (const el of root.querySelectorAll<HTMLElement>('[data-burn]')) {
    const r = el.getBoundingClientRect()
    // nearest point of the element to where the burn began, in screen heights
    const dx = Math.max(r.left - origin[0], 0, origin[0] - r.right)
    const dy = Math.max(r.top - origin[1], 0, origin[1] - r.bottom)
    const d = Math.hypot(dx, dy) / h
    // it catches a little before the edge arrives, so it's gone by the time the white is there
    let p = 0
    while (p < 1 && burnRadius(p, reach) + burnRoughness(burnRadius(p, reach)) * 0.6 + 0.2 < d) p += 0.01
    el.style.setProperty('--burn-delay', `${(p * duration).toFixed(2)}s`)
    el.classList.add('is-burning')
  }
}

/**
 * Minimal UI: the 3D world is the page; the text only frames it.
 * The title sits in the sky, the goal just above the nocked arrow, the pull
 * hint under the bow; the bow places the goal and drives the reticle. A hit
 * on the 404 turns the title over, the text burns off with the world, and
 * once all is white we're home.
 */
export function Overlay({ visible }: { visible: boolean }) {
  const [won, setWon] = useState(false)
  const [turned, setTurned] = useState(false)
  const [white, setWhite] = useState(false)
  const [hint, setHint] = useState<'show' | 'pulse' | 'hide'>('show')
  // the goal steps aside while the bow is up (back after a mere tap) and is gone once an arrow flies
  const [cue, setCue] = useState<'show' | 'hide' | 'gone'>('show')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offs = [
      worldEvents.on('bow:raise', () => setCue((c) => (c === 'gone' ? c : 'hide'))),
      worldEvents.on('bow:tap', () => {
        setHint((h) => (h === 'hide' ? h : 'pulse'))
        setCue((c) => (c === 'gone' ? c : 'show'))
      }),
      worldEvents.on('arrow:fire', () => {
        setHint('hide')
        setCue('gone')
      }),
      worldEvents.on('arrow:hit', (e) => e.surface === 'monument' && setWon(true)),
      worldEvents.on('finale:burn', (e) => root.current && burnOff(root.current, e.origin, e.duration)),
      worldEvents.on('finale:done', () => {
        setWhite(true)
        window.location.assign(HOME_URL)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // a tap without pulling nudges the hint, then it settles back
  useEffect(() => {
    if (hint !== 'pulse') return
    const id = window.setTimeout(() => setHint((h) => (h === 'pulse' ? 'show' : h)), 700)
    return () => window.clearTimeout(id)
  }, [hint])

  useEffect(() => {
    if (!won) return
    setHint('hide')
    setCue('gone')
    // fetch home while the monument comes down, so the last step is instant
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.href = HOME_URL
    document.head.appendChild(link)
    const turn = window.setTimeout(() => setTurned(true), HEADLINE_DELAY)
    const leave = window.setTimeout(() => window.location.assign(HOME_URL), FALLBACK_LEAVE)
    return () => {
      window.clearTimeout(turn)
      window.clearTimeout(leave)
    }
  }, [won])

  // coming back from home restores this page as it was left (all white): start the world afresh
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && window.location.reload()
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  return (
    <>
      <div ref={root} className={`overlay${visible ? ' overlay--visible' : ''}${turned ? ' overlay--won' : ''}`}>
        <p className="eyebrow" data-burn>
          Error<span className="eyebrow__sep">/</span>
          <span className="eyebrow__code">404</span>
        </p>
        <a className="home" href={HOME_URL} data-burn>
          Go home
          <svg className="home__arrow" viewBox="0 0 15 10" fill="none" aria-hidden="true">
            <path d="M0 5h13.2M9.4 1.2 13.2 5l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </a>

        <header className="headline" aria-live="polite">
          <h1 key={turned ? 'won' : 'lost'} className="headline__title" data-burn>
            {turned ? 'Bullseye.' : 'Oops. Wrong turn.'}
          </h1>
          {turned && (
            <p className="headline__sub" data-burn>
              Taking you home…
            </p>
          )}
        </header>

        <p className={`cue${cue === 'show' ? '' : ' cue--hide'}`} ref={(el) => void (hud.cue = el)}>
          <span className="cue__text">
            Hit the <em>404</em> with an arrow to go&nbsp;home.
          </span>
        </p>

        <div className={`hint hint--${hint}`} aria-hidden="true">
          <span className="hint__gesture">
            <span className="hint__dot" />
          </span>
          <span className="hint__text">
            <span>Press &amp; pull down to draw</span>
            <span className="hint__sep">·</span>
            <span>Release to shoot</span>
          </span>
        </div>

        <div className="reticle" data-state="off" ref={(el) => void (hud.reticle = el)} aria-hidden="true">
          <span className="reticle__ring" />
          <span className="reticle__dot" />
        </div>
      </div>
      <div className={`whiteout${white ? ' whiteout--on' : ''}`} aria-hidden="true" />
    </>
  )
}
