"""JavaScript-compatible JSON text and digests.

The Node library computes fingerprints as ``sha256(JSON.stringify(value))`` and
writes its journal with ``JSON.stringify``. Matching it byte for byte requires
JavaScript's rules where Python's ``json`` differs:

* integral numbers print without a fractional part (``1``, not ``1.0``), and
  ``-0`` prints as ``0``;
* lone UTF-16 surrogates are escaped (well-formed ``JSON.stringify``);
* string length limits count UTF-16 code units.

Object key order is insertion order in both languages; callers construct dicts
in the same order as the Node code.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import UTC, datetime
from typing import Any

_LONE_SURROGATE = re.compile(r"[\ud800-\udfff]")
# Number.MAX_SAFE_INTEGER
MAX_SAFE_INTEGER = 2**53 - 1


def js_number(value: Any) -> Any:
    """Return ``value`` with integral floats turned into ints, as JS numbers print."""
    if (
        isinstance(value, float)
        and math.isfinite(value)
        and value.is_integer()
        and abs(value) <= MAX_SAFE_INTEGER
    ):
        return int(value)
    return value


def _normalise(value: Any) -> Any:
    """Recursively apply JavaScript number printing rules."""
    if isinstance(value, dict):
        return {key: _normalise(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalise(item) for item in value]
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    return js_number(value)


def stringify(value: Any) -> str:
    """``JSON.stringify(value)`` for the plain JSON data the journal holds."""
    text = json.dumps(_normalise(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    # Python leaves lone surrogates raw; JSON.stringify escapes them as \udXXX.
    return _LONE_SURROGATE.sub(lambda match: f"\\u{ord(match.group()):04x}", text)


def encode(text: str) -> bytes:
    """UTF-8 bytes as Node's ``Buffer``/``createHash`` produce (lone surrogates become U+FFFD)."""
    return text.encode("utf-8", "replace") if _LONE_SURROGATE.search(text) else text.encode("utf-8")


def digest(value: Any) -> str:
    """``sha256(JSON.stringify(value))`` in lowercase hex."""
    return hashlib.sha256(encode(stringify(value))).hexdigest()


def utf16_length(text: str) -> int:
    """JavaScript ``string.length``: UTF-16 code units."""
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def iso_now() -> str:
    """``new Date().toISOString()``: UTC with milliseconds and a ``Z`` suffix."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def safe_integer(value: Any) -> int | None:
    """Return the integer for ``Number.isSafeInteger(value)``, else ``None`` (booleans are not numbers)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and abs(value) <= MAX_SAFE_INTEGER:
        return value
    if (
        isinstance(value, float)
        and math.isfinite(value)
        and value.is_integer()
        and abs(value) <= MAX_SAFE_INTEGER
    ):
        return int(value)
    return None


def finite_number(value: Any) -> float | int | None:
    """Return the number for ``Number.isFinite(value)``, else ``None``."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return js_number(value) if math.isfinite(value) else None
