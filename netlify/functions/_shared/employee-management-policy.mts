export type EmployeeManagementAction = 'update-role' | 'deactivate-account' | 'reactivate-account' | 'update-profile'

export function employeeManagementPolicy(input: {
  actorRole: string
  actorUserId: string
  targetRole: string
  targetUserId: string
  action: EmployeeManagementAction
  requestedRole?: string
}) {
  if (input.action === 'update-profile') {
    if (input.actorRole !== 'owner') {
      return { allowed: false, status: 403, message: 'Nur Hauptadmin darf Mitarbeiterdaten bearbeiten.' }
    }
    return { allowed: true, status: 200, message: '' }
  }

  if (!['owner', 'admin'].includes(input.actorRole)) {
    return { allowed: false, status: 403, message: 'Nur Hauptadmin oder Admin dürfen Mitarbeiterkonten verwalten.' }
  }
  if (input.targetRole === 'owner' || (input.actorRole === 'owner' && input.actorUserId === input.targetUserId)) {
    return { allowed: false, status: 403, message: 'Der Hauptadmin ist geschützt und kann nicht verändert oder deaktiviert werden.' }
  }
  if (input.actorRole === 'admin' && input.targetRole === 'admin') {
    return { allowed: false, status: 403, message: 'Nur Hauptadmin darf Admin-Konten ändern oder deaktivieren.' }
  }
  if (input.action === 'update-role' && input.requestedRole === 'admin' && input.actorRole !== 'owner') {
    return { allowed: false, status: 403, message: 'Nur Hauptadmin darf weitere Admins bestimmen.' }
  }
  return { allowed: true, status: 200, message: '' }
}
