enum ReminderScheduleType { weekly, everyXDays, oneOff }

class PortalReminder {
  const PortalReminder({
    required this.id,
    required this.portalId,
    required this.title,
    required this.scheduleType,
    required this.nextTriggerAt,
    required this.enabled,
  });

  final String id;
  final String portalId;
  final String title;
  final ReminderScheduleType scheduleType;
  final DateTime nextTriggerAt;
  final bool enabled;
}
