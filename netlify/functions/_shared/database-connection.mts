import { getConnectionString } from '@netlify/database'

function environmentConnectionString() {
  const runtimeValue = typeof Netlify !== 'undefined'
    ? Netlify.env.get('ATTENDANCE_DATABASE_URL')
      || Netlify.env.get('DATABASE_URL')
      || Netlify.env.get('NETLIFY_DATABASE_URL')
    : ''

  return runtimeValue
    || process.env.ATTENDANCE_DATABASE_URL
    || process.env.DATABASE_URL
    || process.env.NETLIFY_DATABASE_URL
    || ''
}

export function databaseConnectionString() {
  const configured = environmentConnectionString()
  if (configured) return configured

  try {
    return getConnectionString() || ''
  } catch {
    return ''
  }
}
