"""Load the small, versioned broad-category taxonomy shipped in the package."""

from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Any


@dataclass(frozen=True)
class CategoryDefinition:
    id: str
    label: str
    prompt: str


def _read_string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{context} must be a non-empty string")
    return value


def load_category_taxonomy() -> tuple[CategoryDefinition, ...]:
    resource = files("recognition_core.data").joinpath("category_taxonomy_v1.json")
    raw = json.loads(resource.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise ValueError("Unsupported category taxonomy version")
    raw_categories = raw.get("categories")
    if not isinstance(raw_categories, list) or not raw_categories:
        raise ValueError("Category taxonomy must contain categories")
    categories: list[CategoryDefinition] = []
    ids: set[str] = set()
    labels: set[str] = set()
    for index, raw_category in enumerate(raw_categories):
        if not isinstance(raw_category, dict):
            raise ValueError(f"Category taxonomy entry {index} must be an object")
        category = CategoryDefinition(
            id=_read_string(raw_category.get("id"), f"Category taxonomy entry {index}.id"),
            label=_read_string(raw_category.get("label"), f"Category taxonomy entry {index}.label"),
            prompt=_read_string(
                raw_category.get("prompt"), f"Category taxonomy entry {index}.prompt"
            ),
        )
        if category.id in ids or category.label in labels:
            raise ValueError("Category taxonomy IDs and labels must be unique")
        ids.add(category.id)
        labels.add(category.label)
        categories.append(category)
    return tuple(categories)
