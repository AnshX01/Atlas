"""Unit tests for Pydantic schemas."""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from app.domain.schemas.auth import RegisterRequest, LoginRequest


class TestRegisterRequest:
    def test_valid_registration(self):
        req = RegisterRequest(email="alex@example.com", password="SecurePass1", full_name="Alex")
        assert req.email == "alex@example.com"
        assert req.full_name == "Alex"

    def test_password_too_short(self):
        with pytest.raises(ValidationError):
            RegisterRequest(email="a@b.com", password="Short1")

    def test_password_missing_uppercase(self):
        with pytest.raises(ValidationError, match="uppercase"):
            RegisterRequest(email="a@b.com", password="nouppercase1")

    def test_password_missing_digit(self):
        with pytest.raises(ValidationError, match="digit"):
            RegisterRequest(email="a@b.com", password="NoDigitPass")

    def test_invalid_email(self):
        with pytest.raises(ValidationError):
            RegisterRequest(email="not-an-email", password="ValidPass1")


class TestLoginRequest:
    def test_valid_login(self):
        req = LoginRequest(email="taylor@startup.com", password="anypassword")
        assert req.email == "taylor@startup.com"

    def test_email_required(self):
        with pytest.raises(ValidationError):
            LoginRequest(password="somepass")
