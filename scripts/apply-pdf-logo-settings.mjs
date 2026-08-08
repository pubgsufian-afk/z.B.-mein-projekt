import { readFile, writeFile } from 'node:fs/promises'

async function rewrite(path, transform) {
  const source = await readFile(path, 'utf8')
  const next = transform(source)
  if (next !== source) await writeFile(path, next)
  return next !== source
}

function ensureImport(source, anchor, statement) {
  if (source.includes(statement)) return source
  if (!source.includes(anchor)) throw new Error(`Import anchor missing: ${anchor}`)
  return source.replace(anchor, `${anchor}${statement}\n`)
}

function replaceRequired(source, pattern, replacement, label) {
  if (typeof pattern === 'string') {
    if (source.includes(replacement)) return source
    if (!source.includes(pattern)) throw new Error(`Patch target missing: ${label}`)
    return source.replace(pattern, replacement)
  }
  if (pattern.test(source)) return source.replace(pattern, replacement)
  if (typeof replacement === 'string' && source.includes(replacement.trim())) return source
  throw new Error(`Patch target missing: ${label}`)
}

const settingsPage = String.raw`function SettingsPage({ session }) {
  const [form, setForm] = useState({ companyName: 'Habun Security', phone: '', email: '', address: '', logoUrl: '/habun-logo.png' })
  const [logoDraft, setLogoDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const isOwner = session.role === 'owner'
  const load = useCallback(async () => {
    try {
      const data = await apiJson('/api/company-settings')
      setForm((current) => ({ ...current, ...(data.settings || {}) }))
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    }
  }, [])
  useEffect(() => { load() }, [load])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const data = await apiJson('/api/company-settings', {
        method: 'PUT',
        body: JSON.stringify({ companyName: form.companyName, phone: form.phone, email: form.email, address: form.address }),
      })
      setForm((current) => ({ ...current, ...data.settings }))
      setNotice({ tone: 'success', text: 'Firmendaten wurden gespeichert und werden automatisch in neuen PDFs verwendet.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function chooseLogo(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setLogoBusy(true)
    setNotice(null)
    try {
      const prepared = await preparePdfLogo(file)
      setLogoDraft(prepared)
      setNotice({ tone: 'success', text: 'Logo vorbereitet. Bitte die Vorschau prüfen und anschließend speichern.' })
    } catch (error) {
      setLogoDraft('')
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setLogoBusy(false)
      event.target.value = ''
    }
  }

  async function saveLogo() {
    if (!logoDraft) return
    setLogoBusy(true)
    setNotice(null)
    try {
      const data = await apiJson('/api/company-settings', {
        method: 'PUT',
        body: JSON.stringify({ pdfLogoDataUrl: logoDraft }),
      })
      setForm((current) => ({ ...current, ...data.settings }))
      setLogoDraft('')
      setNotice({ tone: 'success', text: 'PDF-Logo wurde gespeichert. Neue PDFs verwenden es automatisch.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setLogoBusy(false)
    }
  }

  async function resetLogo() {
    setLogoBusy(true)
    setNotice(null)
    try {
      const data = await apiJson('/api/company-settings', {
        method: 'PUT',
        body: JSON.stringify({ resetPdfLogo: true }),
      })
      setForm((current) => ({ ...current, ...data.settings }))
      setLogoDraft('')
      setNotice({ tone: 'success', text: 'Das Standardlogo wird wieder für neue PDFs verwendet.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setLogoBusy(false)
    }
  }

  const previewLogo = logoDraft || form.logoUrl || '/habun-logo.png'

  return <>
    <Notice notice={notice} />
    <section className="settings-layout">
      <section className="panel">
        <PageHeader title="Firmendaten" subtitle="Einmal speichern – automatisch in jedem neuen Bericht verwenden." />
        <form className="settings-form" onSubmit={save}>
          <label>Firmenname<input value={form.companyName || ''} onChange={update('companyName')} required /></label>
          <label>Telefonnummer<input type="tel" value={form.phone || ''} onChange={update('phone')} required /></label>
          <label>E-Mail-Adresse<input type="email" value={form.email || ''} onChange={update('email')} required /></label>
          <label>Firmenadresse<input value={form.address || ''} onChange={update('address')} required /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Einstellungen speichern'}</button>
        </form>
      </section>

      <aside className="panel settings-preview pdf-logo-settings">
        <PageHeader title="Firmenlogo / PDF-Logo" subtitle="Dieses Logo wird automatisch als dezentes Wasserzeichen in der Mitte neuer PDFs verwendet." />
        <div className="pdf-logo-preview"><img src={previewLogo} alt="Vorschau Firmenlogo" /></div>
        {isOwner ? <>
          <label className="pdf-logo-file">Logo auswählen<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} disabled={logoBusy} /><small>PNG, JPG/JPEG oder WebP. Der zusammenhängende Hintergrund am Bildrand wird automatisch entfernt.</small></label>
          <div className="form-actions pdf-logo-actions">
            <button className="primary-button" type="button" disabled={!logoDraft || logoBusy} onClick={saveLogo}>{logoBusy ? 'Bitte warten …' : 'Logo speichern'}</button>
            <button className="secondary-button" type="button" disabled={logoBusy} onClick={resetLogo}>Auf Standardlogo zurücksetzen</button>
          </div>
        </> : <p className="security-note">Nur der Hauptadmin kann das PDF-Logo ändern. Die gespeicherte Vorschau ist für Admins nur lesbar.</p>}
        <p>Firmendaten und Logo werden bei neuen PDF-Berichten automatisch eingesetzt.</p>
      </aside>
    </section>
  </>
}`

await rewrite('frontend/src/App.jsx', (original) => {
  let source = original
  const reactLine = "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n"
  source = ensureImport(source, reactLine, "import { preparePdfLogo } from './pdf-logo-tools.js'")
  const start = source.indexOf('function SettingsPage(')
  const end = source.indexOf('\n\nfunction UnifiedPortal', start)
  if (start < 0 || end < 0) throw new Error('SettingsPage block not found')
  source = `${source.slice(0, start)}${settingsPage}${source.slice(end)}`
  source = source.replace("page === 'settings' ? <SettingsPage />", "page === 'settings' ? <SettingsPage session={session} />")
  return source
})

await rewrite('netlify/functions/schedule-pdf.mts', (original) => {
  let source = original
  source = ensureImport(source, "import { readCompanySettings } from './_shared/company-settings.mts'\n", "import { drawCenteredPdfWatermark, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'")
  source = source.replace(/\nasync function embedLogo\(pdf: PDFDocument, request: Request, logoUrl: string\) \{[\s\S]*?\n\}\n\nasync function buildSchedulePdf/, '\nasync function buildSchedulePdf')
  source = replaceRequired(source, '  const logo = await embedLogo(pdf, request, settings.logoUrl)', '  const logo = await loadOriginalLogo(pdf, request)', 'schedule-pdf logo load')
  source = source.replace(/    if \(logo\) \{\n      const scale = Math\.min\(74 \/ logo\.width, 58 \/ logo\.height\)\n      page\.drawImage\(logo, \{ x: margin, y: y - logo\.height \* scale \+ 4, width: logo\.width \* scale, height: logo\.height \* scale \}\)\n    \}/, '    drawCenteredPdfWatermark(page, logo, width, height, 210, 170, 0.06)')
  return source
})

await rewrite('netlify/functions/schedule-pdf-fixed.mts', (original) => {
  let source = original
  source = source.replace("import { centeredTextX, drawCenteredShieldLogo, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'", "import { centeredTextX, drawCenteredPdfWatermark, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'")
  source = source.replace('    drawCenteredShieldLogo(page, logo, width, height - 22, 64)', '    drawCenteredPdfWatermark(page, logo, width, height, 210, 170, 0.06)')
  return source
})

await rewrite('netlify/functions/unified-reports.mts', (original) => {
  let source = original
  source = ensureImport(source, "import { readCompanySettings } from './_shared/company-settings.mts'\n", "import { drawCenteredPdfWatermark, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'")
  source = source.replace(/  let logo: any = null\n  try \{\n    const response = await fetch\(new URL\(settings\.logoUrl \|\| '\/habun-logo\.png', request\.url\)\)\n    if \(response\.ok\) \{\n      const bytes = await response\.arrayBuffer\(\)\n      logo = response\.headers\.get\('content-type'\)\?\.includes\('jpeg'\) \? await pdf\.embedJpg\(bytes\) : await pdf\.embedPng\(bytes\)\n    \}\n  \} catch \{\}/, '  const logo = await loadOriginalLogo(pdf, request)')
  source = source.replace(/    if \(logo\) \{\n      const scale = Math\.min\(86 \/ logo\.width, 64 \/ logo\.height\)\n      page\.drawImage\(logo, \{ x: margin, y: y - logo\.height \* scale \+ 8, width: logo\.width \* scale, height: logo\.height \* scale \}\)\n    \}/, '    drawCenteredPdfWatermark(page, logo, pageWidth, pageHeight, 220, 175, 0.06)')
  return source
})

await rewrite('netlify/functions/timesheet-reports.mts', (original) => {
  let source = original
  source = ensureImport(source, "import { readCompanySettings } from './_shared/company-settings.mts'\n", "import { drawCenteredPdfWatermark, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'")
  source = source.replace(/\nasync function embedLogo\(pdf: any, request: Request, logoUrl: string\) \{[\s\S]*?\n\}\n\nasync function buildPdf/, '\nasync function buildPdf')
  source = replaceRequired(source, '  const logo = await embedLogo(pdf, request, settings.logoUrl)', '  const logo = await loadOriginalLogo(pdf, request)', 'timesheet logo load')
  source = source.replace(/    const drawWatermark = \(\) => \{[\s\S]*?\n    \}\n\n    const drawHeader/, `    const drawWatermark = () => {
      drawCenteredPdfWatermark(page, logo, width, height, 210, 155, 0.06)
    }

    const drawHeader`)
  return source
})

await rewrite('netlify/functions/unified-reports-fixed.mts', (original) => {
  let source = original
  source = source.replace("import { centeredTextX, drawCenteredShieldLogo, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'", "import { centeredTextX, drawCenteredPdfWatermark, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'")
  source = source.replace(/drawCenteredShieldLogo\(page, logo, width, height - 22, 94\)/g, 'drawCenteredPdfWatermark(page, logo, width, height, 220, 175, 0.06)')
  return source
})

console.log('Central PDF logo settings applied')
