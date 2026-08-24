type PushCoreModule = {
  sendPushToUsers?: (options: { userIds: string[]; title: string; body: string; url?: string }) => Promise<unknown>
  sendPortalPush?: (options: { actorRole?: string; targetUserId?: string; title: string; body: string; url?: string }) => Promise<unknown>
}

export async function sendAdminPortalPush(options: {
  targetUserId?: string
  title: string
  body: string
  url?: string
}) {
  const core = await import('./push-core.mts') as PushCoreModule
  if (typeof core.sendPushToUsers === 'function') {
    return core.sendPushToUsers({
      userIds: options.targetUserId ? [options.targetUserId] : [],
      title: options.title,
      body: options.body,
      url: options.url,
    })
  }
  if (typeof core.sendPortalPush === 'function') {
    return core.sendPortalPush({
      actorRole: 'owner',
      targetUserId: options.targetUserId,
      title: options.title,
      body: options.body,
      url: options.url,
    })
  }
  throw new Error('Push-Versand ist nicht verfügbar.')
}
