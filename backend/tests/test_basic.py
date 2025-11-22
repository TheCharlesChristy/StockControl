"""Basic test to verify the test infrastructure is working."""
import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app)


def test_health_endpoint(client):
    """Test the health check endpoint."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_app_creation():
    """Test that the FastAPI app is created successfully."""
    assert app.title == "Stock Management API"
    assert app.version == "1.0.0"
