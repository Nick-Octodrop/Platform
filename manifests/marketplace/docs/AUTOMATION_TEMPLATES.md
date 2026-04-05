# Automation Templates (Assignment + Record Routing)

Use these templates with `POST /automations/import` then publish via `POST /automations/{id}/publish`.

Notes:
- Trigger filters now support `contains`.
- `record.created` now includes `trigger.record` snapshot.
- `record.updated` and `workflow.status_changed` now include `trigger.before` and `trigger.after` snapshots.
- Record snapshots include:
  - `fields`: nested + short aliases for easy variable paths
  - `flat`: original field ids (`task.assignee_id`, etc.)

## 1) Task Assigned (On Create)

```json
{
  "automation": {
    "name": "Task Assigned - On Create",
    "description": "Notify assignee when a task is created with an assignee.",
    "trigger": {
      "kind": "event",
      "event_types": ["record.created"],
      "filters": [
        { "path": "entity_id", "op": "eq", "value": "entity.task" },
        { "path": "record.fields.assignee_id", "op": "exists", "value": null }
      ]
    },
    "steps": [
      {
        "id": "notify_assignee_create",
        "kind": "action",
        "action_id": "system.notify",
        "inputs": {
          "recipient_user_ids": [{ "var": "trigger.record.fields.assignee_id" }],
          "title": "Task assigned",
          "body": "You were assigned: {{ trigger.record.fields.task.title or trigger.record.fields.title or trigger.record_id }}",
          "severity": "info",
          "link_to": "/data/task/{{ trigger.record_id }}"
        }
      }
    ]
  }
}
```

## 2) Task Reassigned (On Update)

```json
{
  "automation": {
    "name": "Task Assigned - On Reassign",
    "description": "Notify the new assignee when task assignee changes.",
    "trigger": {
      "kind": "event",
      "event_types": ["record.updated"],
      "filters": [
        { "path": "entity_id", "op": "eq", "value": "entity.task" },
        { "path": "changed_fields", "op": "contains", "value": "task.assignee_id" },
        { "path": "after.fields.assignee_id", "op": "exists", "value": null }
      ]
    },
    "steps": [
      {
        "id": "notify_assignee_update",
        "kind": "action",
        "action_id": "system.notify",
        "inputs": {
          "recipient_user_ids": [{ "var": "trigger.after.fields.assignee_id" }],
          "title": "Task reassigned",
          "body": "You are now assigned: {{ trigger.after.fields.task.title or trigger.after.fields.title or trigger.record_id }}",
          "severity": "info",
          "link_to": "/data/task/{{ trigger.record_id }}"
        }
      }
    ]
  }
}
```

## 3) Task Participants Updated

```json
{
  "automation": {
    "name": "Task Participants - Notify",
    "description": "Notify all participants when participant list changes.",
    "trigger": {
      "kind": "event",
      "event_types": ["record.updated"],
      "filters": [
        { "path": "entity_id", "op": "eq", "value": "entity.task" },
        { "path": "changed_fields", "op": "contains", "value": "task.participant_ids" },
        { "path": "after.fields.participant_ids", "op": "exists", "value": null }
      ]
    },
    "steps": [
      {
        "id": "notify_participants",
        "kind": "action",
        "action_id": "system.notify",
        "inputs": {
          "recipient_user_ids": [{ "var": "trigger.after.fields.participant_ids" }],
          "title": "Task participants updated",
          "body": "Participants were updated for task: {{ trigger.after.fields.task.title or trigger.after.fields.title or trigger.record_id }}",
          "severity": "info",
          "link_to": "/data/task/{{ trigger.record_id }}"
        }
      }
    ]
  }
}
```

## 4) Calendar Event Participants (Create + Update)

```json
{
  "automation": {
    "name": "Calendar Participants - Notify",
    "description": "Notify event participants on create and when participants change.",
    "trigger": {
      "kind": "event",
      "event_types": ["record.created", "record.updated"],
      "filters": [
        { "path": "entity_id", "op": "eq", "value": "entity.calendar_event" }
      ]
    },
    "steps": [
      {
        "id": "notify_event_participants",
        "kind": "action",
        "action_id": "system.notify",
        "inputs": {
          "recipient_user_ids": [
            { "var": "trigger.record.fields.participant_ids" },
            { "var": "trigger.after.fields.participant_ids" }
          ],
          "title": "Calendar event update",
          "body": "Event: {{ trigger.record.fields.calendar_event.title or trigger.after.fields.calendar_event.title or trigger.record_id }}",
          "severity": "info",
          "link_to": "/data/calendar_event/{{ trigger.record_id }}"
        }
      }
    ]
  }
}
```

## 5) Variation Decision -> Notify Requester

```json
{
  "automation": {
    "name": "Variation Decision - Notify Requester",
    "description": "Notify variation requester when decision status changes.",
    "trigger": {
      "kind": "event",
      "event_types": ["workflow.status_changed"],
      "filters": [
        { "path": "entity_id", "op": "eq", "value": "entity.variation" },
        { "path": "to", "op": "in", "value": ["approved", "rejected"] },
        { "path": "after.fields.requested_by", "op": "exists", "value": null }
      ]
    },
    "steps": [
      {
        "id": "notify_variation_requester",
        "kind": "action",
        "action_id": "system.notify",
        "inputs": {
          "recipient_user_ids": [{ "var": "trigger.after.fields.requested_by" }],
          "title": "Variation decision",
          "body": "Variation {{ trigger.after.fields.variation.number or trigger.record_id }} is now {{ trigger.to }}.",
          "severity": "info",
          "link_to": "/data/variation/{{ trigger.record_id }}"
        }
      }
    ]
  }
}
```

## Import Example

```bash
curl -X POST http://localhost:8000/automations/import \
  -H "Content-Type: application/json" \
  -d @automation.json
```

