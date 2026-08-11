from __future__ import annotations

import io

import pytest
from PIL import Image


@pytest.fixture
def jpeg_bytes() -> bytes:
    image = Image.new("RGB", (400, 300), color=(120, 130, 140))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()
