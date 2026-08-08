import { readFile, writeFile } from 'node:fs/promises'

const path = 'frontend/src/App.jsx'
let source = await readFile(path, 'utf8')
let changed = false

const requiredAddress = `<label>Firmenadresse<input value={form.address || ''} onChange={update('address')} required /></label>`
const compatibleAddress = `<label>Firmenadresse<input value={form.address || ''} onChange={update('address')} /><small>Optional. Bleibt leer, wenn keine neue Firmenadresse gespeichert werden soll.</small></label>`
if (source.includes(requiredAddress)) {
  source = source.replace(requiredAddress, compatibleAddress)
  changed = true
}

const logoPreview = `<div className="pdf-logo-preview"><img src={previewLogo} alt="Vorschau Firmenlogo" /></div>`
const companyPreview = `${logoPreview}
        <div className="letterhead-preview pdf-logo-company-preview"><div><strong>{form.companyName || 'Habun Security'}</strong><span>{form.phone || 'Telefonnummer'}</span><span>{form.email || 'E-Mail-Adresse'}</span>{form.address && <span>{form.address}</span>}</div></div>`
if (!source.includes('pdf-logo-company-preview')) {
  if (!source.includes(logoPreview)) throw new Error('PDF logo preview target not found')
  source = source.replace(logoPreview, companyPreview)
  changed = true
}

if (changed) {
  await writeFile(path, source)
  console.log('PDF logo settings UI compatibility applied')
} else {
  console.log('PDF logo settings UI compatibility already applied')
}
