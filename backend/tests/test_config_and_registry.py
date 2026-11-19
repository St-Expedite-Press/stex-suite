from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest
from conftest import PROTOCOL
from pydantic import ValidationError

from stex.config import DEFAULT_REGISTRY, ConfigurationError, Settings, loopback_origin
from stex.platform.registry import load_registry


def test_defaults_are_loopback_and_match_the_dev_alpha_ports() -> None:
    settings = Settings.from_environment({})
    assert (settings.host, settings.port) == ("127.0.0.1", 4340)
    assert dict(settings.engine_origins) == {
        "frige": "http://127.0.0.1:4310",
        "seaxneat": "http://127.0.0.1:4320",
    }


def test_engine_origins_come_from_the_same_variables_pantheon_uses() -> None:
    settings = Settings.from_environment(
        {"STEX_FRIGE_URL": "http://localhost:5001/", "STEX_PLATFORM_PORT": "4999"}
    )
    assert settings.engine_origins["frige"] == "http://localhost:5001"
    assert settings.port == 4999


@pytest.mark.parametrize(
    "value",
    [
        "https://127.0.0.1:4310",
        "http://example.com:4310",
        "http://10.0.0.5:4310",
        "http://user:pw@127.0.0.1:4310",
        "http://127.0.0.1:4310/frige",
        "http://127.0.0.1:4310/?x=1",
        "http://127.0.0.1:4310/#x",
        "http://127.0.0.1:99999",
        "file:///etc/passwd",
        "",
    ],
)
def test_non_loopback_or_decorated_engine_origins_are_refused(value: str) -> None:
    with pytest.raises(ConfigurationError):
        loopback_origin(value, "STEX_FRIGE_URL")
    with pytest.raises(ConfigurationError):
        Settings.from_environment(
            {"STEX_FRIGE_URL": value} if value else {"STEX_SEAXNEAT_URL": "http://0.0.0.0:1"}
        )


@pytest.mark.parametrize(
    "environment",
    [
        {"STEX_PLATFORM_HOST": "0.0.0.0"},
        {"STEX_PLATFORM_PORT": "abc"},
        {"STEX_PLATFORM_PORT": "0"},
        {"STEX_PLATFORM_PORT": "70000"},
        {"STEX_PLATFORM_PORT": "²"},  # isdigit() but not int()-able
    ],
)
def test_the_platform_refuses_non_loopback_binding_and_invalid_ports(environment: dict[str, str]) -> None:
    with pytest.raises(ConfigurationError):
        Settings.from_environment(environment)


def test_the_registry_reader_agrees_with_the_registry_schema() -> None:
    document = json.loads(DEFAULT_REGISTRY.read_text(encoding="utf-8"))
    schema = json.loads((PROTOCOL / "applications" / "registry.v2.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(document, schema)
    registry = load_registry(DEFAULT_REGISTRY)
    assert [app.id for app in registry.active_studios()] == ["frige", "seaxneat"]
    assert {app.id for app in registry.applications} == {app["id"] for app in document["applications"]}


@pytest.mark.parametrize(
    "mutation",
    [
        {"schemaVersion": "stex.applications.registry.v1"},
        {
            "applications": [
                {
                    "id": "x",
                    "name": "X",
                    "kind": "studio",
                    "route": "../x/",
                    "state": "active",
                    "referenceKinds": [],
                }
            ]
        },
        {
            "applications": [
                {
                    "id": "x",
                    "name": "X",
                    "kind": "engine",
                    "route": "/x/",
                    "state": "active",
                    "referenceKinds": [],
                }
            ]
        },
    ],
)
def test_an_invalid_registry_stops_startup(tmp_path: Path, mutation: dict[str, object]) -> None:
    document = {**json.loads(DEFAULT_REGISTRY.read_text(encoding="utf-8")), **mutation}
    path = tmp_path / "registry.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValidationError):
        load_registry(path)
