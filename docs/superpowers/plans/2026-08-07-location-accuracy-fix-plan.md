# GPS accuracy geofence fix plan

1. Add a regression test proving that plausible GPS uncertainty can overlap the configured worksite radius while extreme uncertainty remains capped.
2. Extend location classification with bounded device-accuracy tolerance.
3. Pass browser GPS accuracy through the attendance service and expose non-sensitive diagnostics when a booking is still outside.
4. Keep the repair/build patch compatible with the final source.
5. Run the v2 verification/build before production deployment.
