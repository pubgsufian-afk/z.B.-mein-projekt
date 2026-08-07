import { mkdir, readFile, writeFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/attendance.mts', 'utf8')
const importPattern = /import \{ listScheduleShifts \} from '\.\/_shared\/schedule-neon-repository\.mts'/
const loaderPattern = /async function loadSchedules\(\): Promise<ScheduleEntry\[]> \{\s*return listScheduleShifts\(\)\s*\}/s
const blobLoaderPattern = /async function loadSchedules[\s\S]*?portal-schedule-v2[\s\S]*?\n\}/
const index = source.indexOf('async function loadSchedules')
const diagnostic = {
  importMatches: importPattern.test(source),
  loaderMatches: loaderPattern.test(source),
  blobLoaderMatches: blobLoaderPattern.test(source),
  loaderSnippet: index >= 0 ? source.slice(index, index + 520) : 'loadSchedules not found',
  importSnippet: source.split('\n').filter((line) => line.includes('schedule-neon-repository') || line.includes('database-connection')).join('\n'),
}
await mkdir('public', { recursive: true })
await writeFile('public/debug-attendance-schedule-source.json', JSON.stringify(diagnostic, null, 2))
console.log('attendance schedule source diagnostic captured')
