from main import check_rate_limit
import time, pytest
from fastapi import HTTPException

store = {}

def test_rate_limit_new():
    store = {"127.0.0.1": (0, time.time())}
    check_rate_limit("127.0.0.1", store)
    assert store["127.0.0.1"][0] == 1

def test_rate_limit_exceeded():
    store = {"127.0.0.1": (5, time.time())}
    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit("127.0.0.1", store)
    assert exc_info.value.status_code == 429

def test_rate_limit_window_reset_within_limit():
    store = {"127.0.0.1": (0, time.time() - 61)}
    check_rate_limit("127.0.0.1", store)
    assert store["127.0.0.1"][0] == 1

def test_rate_limit_window_reset_exceeded():
    store = {"127.0.0.1": (5, time.time() - 61)}
    check_rate_limit("127.0.0.1", store)
    assert store["127.0.0.1"][0] == 1
