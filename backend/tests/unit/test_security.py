"""Unit tests for security module."""

from __future__ import annotations

import base64
import os

import pytest

# Patch env vars before importing security
os.environ.setdefault("APP_SECRET_KEY", "test_secret_key_32_characters_xx")
os.environ.setdefault(
    "APP_MASTER_ENCRYPTION_KEY",
    base64.urlsafe_b64encode(b"a" * 32).decode(),
)
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_here_for_unit_tests")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("NEO4J_PASSWORD", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    decrypt_token,
    encrypt_token,
    hash_password,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        pw = "SecurePass123"
        hashed = hash_password(pw)
        assert hashed != pw
        assert hashed.startswith("$2b$")

    def test_verify_correct_password(self):
        pw = "SecurePass123"
        hashed = hash_password(pw)
        assert verify_password(pw, hashed) is True

    def test_reject_wrong_password(self):
        hashed = hash_password("CorrectPass123")
        assert verify_password("WrongPass999", hashed) is False


class TestJWT:
    def test_create_and_decode_access_token(self):
        token = create_access_token(subject="user-uuid-1234")
        payload = decode_token(token)
        assert payload["sub"] == "user-uuid-1234"
        assert payload["type"] == "access"

    def test_refresh_token_type(self):
        token = create_refresh_token(subject="user-uuid-5678")
        payload = decode_token(token)
        assert payload["type"] == "refresh"

    def test_expired_token_raises(self):
        from datetime import timedelta

        from jose import JWTError

        token = create_access_token(subject="user", expires_delta=timedelta(seconds=-1))
        with pytest.raises(JWTError):
            decode_token(token)


class TestEncryption:
    def test_encrypt_decrypt_roundtrip(self):
        plaintext = "ghp_real_github_token_abc123"
        encrypted = encrypt_token(plaintext)
        assert encrypted != plaintext
        decrypted = decrypt_token(encrypted)
        assert decrypted == plaintext

    def test_encrypted_value_is_base64(self):
        encrypted = encrypt_token("test_token")
        # Should be valid base64
        import base64

        decoded = base64.urlsafe_b64decode(encrypted + "==")
        assert len(decoded) > 12  # at least nonce (12) + some ciphertext

    def test_tampered_ciphertext_raises(self):
        encrypted = encrypt_token("test_token")
        tampered = encrypted[:-4] + "XXXX"
        with pytest.raises(ValueError, match="decryption failed"):
            decrypt_token(tampered)
