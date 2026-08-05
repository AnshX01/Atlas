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

from app.core.config import get_settings
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import jwt
from passlib.context import CryptContext

# ── Password hashing ──────────────────────────────────────────────────────────
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    """Return a bcrypt hash of the given password."""
    return _pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against its bcrypt hash."""
    return _pwd_context.verify(plain_password, hashed_password)


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


# ── AES-256-GCM Encryption ────────────────────────────────────────────────────
def _get_aes_key() -> bytes:
    """Derive the 32-byte AES key from the master encryption key env var."""
    settings = get_settings()
    # Pad base64 and decode
    raw = base64.urlsafe_b64decode(settings.APP_MASTER_ENCRYPTION_KEY + "==")
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
    raw = base64.urlsafe_b64decode(encrypted_b64 + "==")
    nonce = raw[:12]
    ciphertext = raw[12:]
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        return plaintext.decode("utf-8")
    except Exception as exc:
        raise ValueError("Token decryption failed — possible data tampering.") from exc
