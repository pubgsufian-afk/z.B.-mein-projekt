import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

await import('./apply-automatic-schedule-push.mjs')

const [client, api, core, schedulePush, portalSchedule, assistantSchedule, commandWorker, reminderWorker, reminderCore, migration] = await Promise.all([
  readFile('frontend/src/push-notifications.js', 'utf8'),
  readFile('netlify/functions/push.mts', 'utf8'),
  readFile('netlify/functions/_shared/push-core.mts', 'utf8'),
  readFile('netlify/functions/_shared/schedule-push.mts', 'utf8'),
  readFile('netlify/functions/schedule-v2-neon.mts', 'utf8'),
  readFile('netlify/functions/schedule-assistant.mts', 'utf8'),
  readFile('netlify/functions/schedule-command-worker.mts', 'utf8'),
  readFile('netlify/functions/schedule-start-reminders.mts', 'utf8'),
  readFile('netlify/functions/_shared/schedule-reminder-core.mts', 'utf8'),
  readFile('netlify/database/migrations/20260816132000_create-schedule-push-reminders/migration.sql', 'utf8'),
])

assert.match(client, /action:\s*'test'/, 'client must request an automatic push test after permission is granted')
assert.match(client, /await syncDeviceToken\(registration, deviceToken\)[\s\S]*if \(requestPermission\)/, 'device token must be synchronized before the test request')
assert.match(api, /action === 'test'/, 'push API must expose an authenticated test action')
assert.match(api, /sendDeviceTestPush\(actor, token\)/, 'test action must target the current user device token')
assert.match(core, /export async function sendDeviceTestPush/, 'push core must provide per-device test delivery')
assert.match(core, /device\.userId !== actor\.userId/, 'test delivery must reject device tokens owned by another user')
assert.match(core, /Benachrichtigungen funktionieren auf diesem Gerät\./, 'test notification text must be explicit')

assert.doesNotMatch(client, /mountAdminSender/, 'manual push sender UI must be removed')
assert.doesNotMatch(client, /data-habun-push-admin/, 'manual push bell must be removed')
assert.doesNotMatch(api, /action === ['"]send['"]/, 'manual send API action must be removed')
assert.doesNotMatch(api, /sendPortalPush/, 'manual send API must not import broadcast sender')
assert.doesNotMatch(core, /export async function sendPortalPush/, 'manual broadcast primitive must be removed')
assert.match(core, /export async function sendPushToUsers/, 'server-side targeted push primitive must exist')
assert.match(core, /userIds:\s*string\[\]/, 'targeted push must require explicit user ids')
assert.match(core, /if \(!userIds\.length\) return \{ targeted: 0/, 'empty recipient list must never broadcast')

assert.doesNotMatch(client, /IOS_GUIDE_DISMISSED_KEY|data-dismiss-ios-guide|habun-push-ios-guide|Zum Home-Bildschirm/, 'build output must not reintroduce an iPhone browser guide')
assert.match(client, /if \(isIOS\(\) && !isStandalone\(\)\) \{\s*clearPushUi\(\)\s*return/, 'normal iPhone browser must keep push UI hidden')
assert.match(client, /deviceToken: localRegistration\?\.token \|\| ''/, 'installed app must resync the previous device token')
assert.match(client, /repair: true/, 'failed granted sync must expose a repair action')
assert.match(api, /registerPushDevice\(actor, endpoint, existingToken\)/, 'build output must preserve device token refresh')
assert.match(core, /existingRecord\?\.userId === actor\.userId && existingRecord\.endpoint === cleanEndpoint/, 'build output must preserve secure token reuse')

assert.match(schedulePush, /Ein neuer Dienstplan wurde veröffentlicht\. Bitte im Mitarbeiterportal prüfen\./)
assert.match(schedulePush, /Dein Dienstplan wurde geändert\. Bitte im Mitarbeiterportal prüfen\./)
assert.match(schedulePush, /Dein Dienst beginnt gleich\. Bitte rechtzeitig einchecken\./)
assert.match(portalSchedule, /notifySchedulePublished/)
assert.match(portalSchedule, /notifyScheduleChanged/)
assert.match(portalSchedule, /publishedShiftIds = new Set\(result\.shiftIds\)/, 'week publication must dedupe the actual published shifts')
assert.match(assistantSchedule, /notifySchedulePublished/)
assert.match(assistantSchedule, /notifyScheduleChanged/)
assert.match(assistantSchedule, /publishedUserIds = results\.flatMap/, 'assistant batch must aggregate successful publication recipients')
assert.doesNotMatch(commandWorker, /notifySchedulePublished|notifyScheduleChanged|notifyShiftStartingSoon/, 'batch worker must inherit push from schedule assistant instead of double sending')

assert.match(reminderWorker, /AT TIME ZONE 'Europe\/Berlin'/, 'reminders must use Europe/Berlin DST-aware time conversion')
assert.match(reminderWorker, /interval '4 minutes'/)
assert.match(reminderWorker, /interval '6 minutes'/)
assert.match(reminderWorker, /ON CONFLICT \(reminder_key\) DO NOTHING/, 'reminders must be atomically claimed')
assert.match(reminderWorker, /schedule:\s*'\* \* \* \* \*'/, 'reminder worker must run every minute')
assert.match(reminderWorker, /shouldReleaseReminderClaim\(result\)/)
assert.match(reminderCore, /result\.targeted === 0/, 'claim is released only when certainly no device was targeted')
assert.match(migration, /CREATE TABLE schedule_push_reminders/)
assert.match(migration, /reminder_key text PRIMARY KEY/)

console.log('push automatic schedule notification source contract: ok')
