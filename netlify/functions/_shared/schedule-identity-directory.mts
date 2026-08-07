export type ScheduleIdentityUser = {
  id?: unknown
  email?: unknown
  roles?: unknown
  role?: unknown
  appMetadata?: { roles?: unknown } | null
  userMetadata?: Record<string, unknown> | null
}

export type ScheduleAccessRecord = {
  userId?: unknown
  role?: unknown
  status?: unknown
  fullName?: unknown
  location?: unknown
}

export type ScheduleDirectoryEmployee = {
  userId: string
  fullName: string
  role: 'owner' | 'admin' | 'manager' | 'scheduler' | 'employee'
  status: 'active'
  location: string
}

const ACTIVE_ROLES = new Set(['owner', 'admin', 'manager', 'scheduler', 'employee'])

function text(value: unknown) {
  return String(value ?? '').trim()
}

function identityRoles(user: ScheduleIdentityUser) {
  const values: string[] = []
  if (Array.isArray(user.roles)) values.push(...user.roles.map(text))
  if (Array.isArray(user.appMetadata?.roles)) values.push(...user.appMetadata.roles.map(text))
  if (typeof user.role === 'string') values.push(text(user.role))
  return values.filter((value) => ACTIVE_ROLES.has(value))
}

function metadataText(user: ScheduleIdentityUser, ...keys: string[]) {
  const metadata = user.userMetadata || {}
  for (const key of keys) {
    const value = text(metadata[key])
    if (value) return value
  }
  return ''
}

export function mergeScheduleIdentityDirectory(
  users: ScheduleIdentityUser[],
  accessRows: ScheduleAccessRecord[],
  ownerEmails: Set<string>,
): ScheduleDirectoryEmployee[] {
  const accessByUser = new Map(
    accessRows
      .map((row) => [text(row.userId), row] as const)
      .filter(([userId]) => Boolean(userId)),
  )

  const employees = users.flatMap((user) => {
    const userId = text(user.id)
    if (!userId) return []

    const email = text(user.email).toLowerCase()
    const access = accessByUser.get(userId)
    const accessStatus = text(access?.status)
    if (accessStatus === 'inactive' || accessStatus === 'rejected') return []

    const accessRole = text(access?.role)
    const role = ownerEmails.has(email)
      ? 'owner'
      : accessStatus === 'active' && ACTIVE_ROLES.has(accessRole)
        ? accessRole
        : identityRoles(user)[0] || ''
    if (!ACTIVE_ROLES.has(role)) return []

    const fullName = text(access?.fullName) || metadataText(user, 'full_name', 'fullName', 'name')
    if (!fullName) return []

    const location = text(access?.location) || metadataText(user, 'location')
    return [{
      userId,
      fullName,
      role: role as ScheduleDirectoryEmployee['role'],
      status: 'active' as const,
      location,
    }]
  })

  return employees.sort((left, right) => left.fullName.localeCompare(right.fullName, 'de'))
}
