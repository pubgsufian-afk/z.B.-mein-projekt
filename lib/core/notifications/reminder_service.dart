import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class ReminderService {
  ReminderService(this._notifications);

  final FlutterLocalNotificationsPlugin _notifications;

  Future<void> init() async {
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const settings = InitializationSettings(android: android);
    await _notifications.initialize(settings);
  }

  Future<void> showSimpleReminder({required int id, required String title, required String body}) async {
    const androidDetails = AndroidNotificationDetails(
      'portal_reminder',
      'Portal Erinnerungen',
      channelDescription: 'Lokale Erinnerungen für Portal-Checks',
      importance: Importance.defaultImportance,
    );

    await _notifications.show(
      id,
      title,
      body,
      const NotificationDetails(android: androidDetails),
    );
  }
}
