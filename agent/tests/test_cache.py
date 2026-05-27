from main import get_cached, set_cache, prompt_cache


def test_not_in_cache():
    prompt = "What is the capital of France?"
    assert get_cached(prompt) is None

def test_set_and_get_cache():
    prompt = "What is the capital of France?"
    response = {"answer": "Paris"}
    set_cache(prompt, response)
    cached_response = get_cached(prompt)
    prompt_cache.clear()
    assert cached_response == response

def test_cache_expiration():
    prompt = "What is the capital of France?"
    response = {"answer": "Paris"}
    set_cache(prompt, response)
    
    # Simulate time passing
    prompt_cache[prompt]["timestamp"] -= 61  # Expire the cache
    
    assert get_cached(prompt) is None