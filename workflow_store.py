"""In-memory workflow instance store."""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List


WorkflowInstance = Dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class WorkflowStore:
    def __init__(self) -> None:
        self._instances: Dict[str, WorkflowInstance] = {}

    def create_instance(
        self,
        module_id: str,
        workflow_id: str,
        initial_state: str,
        record_ref: dict | None,
        actor: dict | None,
        reason: str = "init",
    ) -> WorkflowInstance:
        instance_id = str(uuid.uuid4())
        now = _now()
        instance = {
            "instance_id": instance_id,
            "module_id": module_id,
            "workflow_id": workflow_id,
            "record_ref": copy.deepcopy(record_ref),
            "current_state": initial_state,
            "created_at": now,
            "updated_at": now,
            "history": [
                {
                    "at": now,
                    "actor": actor,
                    "from_state": initial_state,
                    "to_state": initial_state,
                    "transition_id": "init",
                    "actions": [],
                    "events": [],
                    "status": "applied",
                    "detail": {"reason": reason},
                }
            ],
        }
        self._instances[instance_id] = copy.deepcopy(instance)
        return copy.deepcopy(instance)

    def get_instance(self, instance_id: str) -> WorkflowInstance:
        instance = self._instances.get(instance_id)
        if instance is None:
            raise KeyError("Instance not found")
        return copy.deepcopy(instance)

    def update_instance(self, instance: WorkflowInstance) -> None:
        if not isinstance(instance, dict) or "instance_id" not in instance:
            raise ValueError("Invalid instance")
        self._instances[instance["instance_id"]] = copy.deepcopy(instance)

    def list_instances(self, module_id: str, workflow_id: str | None = None) -> list[WorkflowInstance]:
        results = []
        for instance in self._instances.values():
            if instance.get("module_id") != module_id:
                continue
            if workflow_id is not None and instance.get("workflow_id") != workflow_id:
                continue
            results.append(copy.deepcopy(instance))
        return results
