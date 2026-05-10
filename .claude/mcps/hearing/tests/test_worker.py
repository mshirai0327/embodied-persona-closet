"""Tests for hearing.worker local audio input selection."""

from hearing import worker


def _default_behavior(_section: str, _key: str, default=None):
    return default


def test_local_input_candidates_linux_defaults_to_alsa(monkeypatch):
    monkeypatch.setattr(worker.platform, "system", lambda: "Linux")
    monkeypatch.setattr(worker, "_is_wsl", lambda: False)
    monkeypatch.setattr(worker, "get_behavior", _default_behavior)
    monkeypatch.delenv("HEARING_LOCAL_INPUT_FORMAT", raising=False)
    monkeypatch.delenv("HEARING_LOCAL_INPUT_DEVICE", raising=False)
    monkeypatch.delenv("PULSE_SERVER", raising=False)
    monkeypatch.delenv("PULSE_SOURCE", raising=False)
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)
    monkeypatch.delenv("WSL_INTEROP", raising=False)

    assert worker._local_input_candidates() == [["-f", "alsa", "-i", "default"]]


def test_local_input_candidates_wsl_prefers_pulse(monkeypatch):
    monkeypatch.setattr(worker.platform, "system", lambda: "Linux")
    monkeypatch.setattr(worker, "_is_wsl", lambda: True)
    monkeypatch.setattr(worker, "get_behavior", _default_behavior)
    monkeypatch.delenv("HEARING_LOCAL_INPUT_FORMAT", raising=False)
    monkeypatch.delenv("HEARING_LOCAL_INPUT_DEVICE", raising=False)
    monkeypatch.delenv("PULSE_SOURCE", raising=False)

    assert worker._local_input_candidates() == [
        ["-f", "pulse", "-i", "default"],
        ["-f", "alsa", "-i", "default"],
    ]


def test_local_input_candidates_respects_override(monkeypatch):
    monkeypatch.setattr(worker.platform, "system", lambda: "Linux")
    monkeypatch.setattr(worker, "_is_wsl", lambda: False)
    monkeypatch.setattr(
        worker,
        "get_behavior",
        lambda _section, key, default=None: {
            "local_input_format": "pulse",
            "local_input_device": "alsa_input.usb-mic",
        }.get(key, default),
    )
    monkeypatch.delenv("HEARING_LOCAL_INPUT_FORMAT", raising=False)
    monkeypatch.delenv("HEARING_LOCAL_INPUT_DEVICE", raising=False)
    monkeypatch.delenv("PULSE_SERVER", raising=False)

    assert worker._local_input_candidates() == [
        ["-f", "pulse", "-i", "alsa_input.usb-mic"],
        ["-f", "alsa", "-i", "default"],
    ]
