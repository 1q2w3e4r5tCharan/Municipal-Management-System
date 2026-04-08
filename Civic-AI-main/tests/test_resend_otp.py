from fastapi.testclient import TestClient
import os
import time

from src.app import app
from src import db

client = TestClient(app)


def setup_module(module):
    # ensure fresh DB for tests
    db.init_db()
    # create a test user
    db.create_user('TestUser', 'test-resend@example.com', password_hash=None, verified=False)


def test_resend_otp_and_cooldown():
    # enable dev return so we can inspect the code
    os.environ['DEV_RETURN_OTP'] = '1'
    # first call: should return dev_otp
    r1 = client.post('/user/resend-otp', json={'email': 'test-resend@example.com'})
    assert r1.status_code == 200
    data1 = r1.json()
    assert 'dev_otp' in data1
    code = data1['dev_otp']
    assert len(code) == 6

    # second immediate call should be throttled (429)
    r2 = client.post('/user/resend-otp', json={'email': 'test-resend@example.com'})
    assert r2.status_code == 429
    # wait for cooldown then resend
    # clear in-app cooldown to allow immediate resend in test
    import src.app as app_mod
    if 'test-resend@example.com' in app_mod.LAST_OTP_SENT:
        del app_mod.LAST_OTP_SENT['test-resend@example.com']
    app_mod.OTP_RESEND_COOLDOWN = 0
    # call again
    r3 = client.post('/user/resend-otp', json={'email': 'test-resend@example.com'})
    assert r3.status_code == 200
    data3 = r3.json()
    assert 'dev_otp' in data3
