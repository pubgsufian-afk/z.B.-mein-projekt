# Null worksite coordinates must not become 0,0

## Problem

A worksite without saved latitude/longitude is currently treated as if it were configured at latitude 0 and longitude 0 because `Number(null)` is `0`. This produces a false distance of roughly 5,900 km for users in Germany and reports them as outside the worksite.

## Expected behavior

- `null`, empty, missing, or non-numeric worksite coordinates are not configured.
- Attendance returns `WORKSITE_NOT_CONFIGURED` instead of calculating distance from 0,0.
- Valid numeric coordinates continue to work.
- Existing GPS accuracy tolerance remains unchanged.
