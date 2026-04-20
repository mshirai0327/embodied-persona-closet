"""Tests for hearing.transcriber error reporting."""

from hearing.transcriber import _describe_model_load_failure


def test_describe_model_load_failure_for_missing_model_bin():
    error = RuntimeError("Unable to open file 'model.bin' in model '/tmp/model'")

    message = _describe_model_load_failure("small", error)

    assert "Whisper model 'small'" in message
    assert "incomplete or corrupted" in message
    assert "whisper_model" in message


def test_describe_model_load_failure_for_generic_error():
    error = RuntimeError("something unexpected happened")

    message = _describe_model_load_failure("small", error)

    assert message == (
        "Whisper model 'small' could not be loaded: something unexpected happened"
    )
