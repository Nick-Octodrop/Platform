Construction Ops v1

This folder contains a starter manifest set for a simple construction operations backend in Octodrop.

Modules:
- `construction_projects.json`
- `construction_workers.json`
- `construction_time_entries.json`
- `construction_material_logs.json`

Suggested install order:
1. `construction_projects.json`
2. `construction_workers.json`
3. `construction_time_entries.json`
4. `construction_material_logs.json`

Design intent:
- Projects are the operational parent records.
- Workers are field users / portal-linked people.
- Time entries are the source of truth for attendance and labor hours.
- Material logs are the source of truth for daily material consumption.

Recommended PWA write targets:
- Clock in / out -> `entity.time_entry`
- Materials used -> `entity.material_log`

Recommended first dashboards:
- Labor hours by project
- Open time entries missing check-out
- Materials used by project and material type
- Daily site activity by date
