"""`python -m app.users` speaks Spanish (the audience is the Spanish-speaking team)."""

import pytest

from app import users


def test_invalid_email_message_is_spanish(capsys: pytest.CaptureFixture[str]) -> None:
    assert users.main(["create-admin", "no-es-un-correo"]) == 1
    assert "Ese correo no parece válido." in capsys.readouterr().err


def test_help_is_spanish(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        users.main(["create-admin", "--help"])
    out = capsys.readouterr().out
    assert "genera la contraseña" in out
    assert "create-admin" in out  # command names stay as they are
