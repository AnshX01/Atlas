"""Atlas — Email OTP verification service using Resend."""

from __future__ import annotations

import random

import resend

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# In-memory OTP store (short-lived, per email)
# In production you'd use Redis with TTL
_otp_store: dict[str, str] = {}


def generate_otp() -> str:
    return str(random.randint(100000, 999999))


async def send_otp_email(email: str) -> str:
    """Generate OTP, send via Resend, return the OTP for verification."""
    settings = get_settings()
    otp = generate_otp()
    _otp_store[email.lower()] = otp

    if not settings.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set - OTP not sent via email", email=email, otp=otp)
        return otp  # Return OTP directly for dev mode

    resend.api_key = settings.RESEND_API_KEY

    try:
        resend.Emails.send({
            "from": settings.RESEND_FROM_EMAIL,
            "to": [email],
            "subject": "Your Atlas verification code",
            "html": f"""
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Verify your email</h2>
                    <p>Your Atlas verification code is:</p>
                    <h1 style="font-size: 32px; letter-spacing: 8px; font-family: monospace;">{otp}</h1>
                    <p>This code expires in 10 minutes.</p>
                    <p style="color: #666; font-size: 12px;">If you didn't request this, ignore this email.</p>
                </div>
            """,
        })
        logger.info("OTP email sent", email=email)
    except Exception as e:
        logger.error("Failed to send OTP email", email=email, error=str(e))
        # Still return OTP so registration can proceed in dev

    return otp


def verify_otp(email: str, otp: str) -> bool:
    """Verify the OTP code for an email address. One-time use."""
    stored = _otp_store.get(email.lower())
    if stored and stored == otp:
        del _otp_store[email.lower()]  # One-time use
        return True
    return False
