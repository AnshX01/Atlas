"""Unit tests for security module."""

from __future__ import annotations

import base64
import os
import time

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
    require_access_token,
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

    def test_algorithm_none_attack(self):
        """Verify that a JWT crafted with alg=none is rejected by decode_token."""
        import json

        from jose import JWTError

        # Manually craft a JWT with alg: none
        header = base64.urlsafe_b64encode(
            json.dumps({"alg": "none", "typ": "JWT"}).encode()
        ).rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(
            json.dumps({"sub": "attacker", "type": "access", "exp": 9999999999}).encode()
        ).rstrip(b"=").decode()
        # alg=none tokens have an empty signature
        forged_token = f"{header}.{payload}."

        with pytest.raises(JWTError):
            decode_token(forged_token)

    def test_refresh_token_cannot_be_used_as_access(self):
        """Verify that require_access_token rejects refresh tokens."""
        token = create_refresh_token(subject="user-uuid-9999")
        payload = decode_token(token)
        assert payload["type"] == "refresh"

        with pytest.raises(ValueError, match="Expected access token, got refresh"):
            require_access_token(token)

    def test_token_type_enforcement_accepts_access(self):
        """Verify that require_access_token passes for access tokens."""
        token = create_access_token(subject="user-uuid-1111")
        payload = require_access_token(token)
        assert payload["sub"] == "user-uuid-1111"
        assert payload["type"] == "access"

    def test_token_type_enforcement_rejects_refresh(self):
        """Verify that require_access_token rejects refresh tokens with ValueError."""
        token = create_refresh_token(subject="user-uuid-2222")
        with pytest.raises(ValueError, match="Expected access token, got refresh"):
            require_access_token(token)


class TestBcryptTiming:
    def test_bcrypt_timing_constant(self):
        """
        Verify bcrypt verify_password has roughly constant timing regardless of
        whether the password is correct or wrong. The difference should be < 50ms.
        """
        pw = "TimingTestPassword123!"
        hashed = hash_password(pw)
        iterations = 100

        # Measure correct password timing
        start = time.perf_counter()
        for _ in range(iterations):
            verify_password(pw, hashed)
        correct_total = time.perf_counter() - start
        correct_avg = correct_total / iterations

        # Measure wrong password timing
        start = time.perf_counter()
        for _ in range(iterations):
            verify_password("WrongPassword999!", hashed)
        wrong_total = time.perf_counter() - start
        wrong_avg = wrong_total / iterations

        # Assert the difference is less than 50ms (bcrypt is inherently constant-time)
        diff_ms = abs(correct_avg - wrong_avg) * 1000
        assert diff_ms < 50, (
            f"Timing difference too large: {diff_ms:.2f}ms "
            f"(correct_avg={correct_avg*1000:.2f}ms, wrong_avg={wrong_avg*1000:.2f}ms)"
        )


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
