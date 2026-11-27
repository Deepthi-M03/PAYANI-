import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from payani.core import security
from payani.core.config import get_settings


def test_hash_is_argon2id_and_verifies():
    h = security.hash_password("a-long-enough-password")
    assert h.startswith("$argon2id$")
    assert security.verify_password(h, "a-long-enough-password")
    assert not security.verify_password(h, "a-long-enough-passworD")


def test_verify_with_missing_hash_is_false():
    assert not security.verify_password(None, "anything-at-all")


def test_access_token_round_trip():
    uid = uuid.uuid4()
    token, ttl = security.create_access_token(uid, ["passenger"])
    claims = security.decode_access_token(token)
    assert claims["sub"] == str(uid)
    assert claims["roles"] == ["passenger"]
    assert ttl == get_settings().access_token_ttl_minutes * 60


def test_expired_token_rejected():
    now = datetime.now(UTC)
    token = jwt.encode(
        {"sub": "x", "type": "access", "iss": "payani", "iat": now - timedelta(hours=1),
         "exp": now - timedelta(minutes=1)},
        get_settings().jwt_secret, algorithm="HS256",
    )
    with pytest.raises(security.TokenError):
        security.decode_access_token(token)


def test_forged_signature_rejected():
    token, _ = security.create_access_token(uuid.uuid4(), ["super_admin"])
    forged = jwt.encode(jwt.decode(token, options={"verify_signature": False}), "x" * 40, algorithm="HS256")
    with pytest.raises(security.TokenError):
        security.decode_access_token(forged)


def test_alg_none_rejected():
    claims = {"sub": "x", "type": "access", "iss": "payani", "iat": 0, "exp": 9999999999}
    unsigned = jwt.encode(claims, key=None, algorithm="none")
    with pytest.raises(security.TokenError):
        security.decode_access_token(unsigned)


def test_refresh_tokens_are_random_and_hashed():
    a, b = security.new_refresh_token(), security.new_refresh_token()
    assert a != b and len(a) >= 60
    assert security.hash_token(a) == security.hash_token(a)
    assert len(security.hash_token(a)) == 64


def test_constant_time_equals_handles_missing_values():
    assert security.constant_time_equals("abc", "abc")
    assert not security.constant_time_equals("abc", None)
    assert not security.constant_time_equals(None, None)
