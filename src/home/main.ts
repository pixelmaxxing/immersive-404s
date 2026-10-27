import '@fontsource-variable/jost'
import './home.css'

// letter by letter, the words settle into place out of the white
const title = document.querySelector<HTMLElement>('.home-page h1')
if (title) {
  const text = title.textContent?.trim() ?? ''
  title.setAttribute('aria-label', text)
  title.textContent = ''
  let i = 0
  text.split(' ').forEach((word, w) => {
    if (w > 0) title.append(' ')
    const span = document.createElement('span')
    span.className = 'word'
    span.setAttribute('aria-hidden', 'true')
    for (const ch of word) {
      const c = document.createElement('span')
      c.className = 'char'
      c.textContent = ch
      c.style.setProperty('--i', String(i++))
      span.append(c)
    }
    title.append(span)
    // a breath between words
    i += 1.5
  })
  title.classList.add('is-split')
}
