"""
Atlas Backend — Security Utilities.

Handles:
  - JWT creation and verification
  - AES-256-GCM encryption/decryption for OAuth tokens at rest
  - Password hashing (bcrypt)
"""

from __future__ import annotations

import base64
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from app.core.config import get_settings
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import jwt

# ── Password hashing ──────────────────────────────────────────────────────────


def hash_password(plain_password: str) -> str:
    """Return a bcrypt hash of the given password."""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against its bcrypt hash."""
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


# ── JWT ───────────────────────────────────────────────────────────────────────
def create_access_token(
    subject: str,
    expires_delta: timedelta | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """
    Create a signed JWT access token.

    Args:
        subject: Usually the user UUID.
        expires_delta: Custom expiry window; defaults to settings value.
        extra_claims: Additional payload fields (e.g., {"role": "admin"}).

    Returns:
        Encoded JWT string.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    expire = now + (expires_delta or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES))
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": expire,
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(subject: str) -> str:
    """Create a longer-lived refresh token."""
    settings = get_settings()
    return create_access_token(
        subject=subject,
        expires_delta=timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
        extra_claims={"type": "refresh"},
    )


def decode_token(token: str) -> dict[str, Any]:
    """
    Decode and validate a JWT token.

    Raises:
        JWTError: If the token is invalid or expired.
    """
    settings = get_settings()
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])


def require_access_token(token: str) -> dict[str, Any]:
    """
    Decode a JWT and enforce that it is an access token.

    Args:
        token: Encoded JWT string.

    Returns:
        Decoded payload dict.

    Raises:
        JWTError: If the token is invalid or expired.
        ValueError: If the token type is not "access".
    """
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise ValueError("Expected access token, got refresh")
    return payload


# ── AES-256-GCM Encryption ────────────────────────────────────────────────────
def _get_aes_key() -> bytes:
    """Derive the 32-byte AES key from the master encryption key env var."""
    settings = get_settings()
    # Pad base64 correctly
    b64_str = settings.APP_MASTER_ENCRYPTION_KEY
    b64_str += "=" * (-len(b64_str) % 4)
    raw = base64.urlsafe_b64decode(b64_str)
    return raw[:32]


def encrypt_token(plaintext: str) -> str:
    """
    Encrypt an OAuth token string using AES-256-GCM.

    Returns:
        Base64-encoded string: nonce (12 bytes) + ciphertext + tag.
    """
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)  # 96-bit nonce (GCM standard)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    # Concatenate nonce + ciphertext (includes 16-byte tag appended by AESGCM)
    encrypted = nonce + ciphertext
    return base64.urlsafe_b64encode(encrypted).decode("utf-8")


def decrypt_token(encrypted_b64: str) -> str:
    """
    Decrypt an AES-256-GCM encrypted token.

    Args:
        encrypted_b64: Base64-encoded nonce + ciphertext from encrypt_token().

    Returns:
        Original plaintext OAuth token.

    Raises:
        ValueError: If decryption fails (tampered data or wrong key).
    """
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    encrypted_b64 += "=" * (-len(encrypted_b64) % 4)
    raw = base64.urlsafe_b64decode(encrypted_b64)
    nonce = raw[:12]
    ciphertext = raw[12:]
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        return plaintext.decode("utf-8")
    except Exception as exc:
        raise ValueError("Token decryption failed — possible data tampering.") from exc
