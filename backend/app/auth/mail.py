"""Optional e-mail of invitation and reset links (stdlib smtplib). Off unless SMTP_HOST and SMTP_FROM are set.

Without it an admin copies the one-time link and sends it personally. Sending happens in a background task after
the response, so its duration never reveals whether an address has an account; a failure is logged (never the
link) and the admin can still generate a link by hand.
"""

import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

log = logging.getLogger("auth")


def send_mail(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as e:
        log.warning("mail: sending %r failed: %s", subject, type(e).__name__)


def invitation_mail(to: str, link: str) -> None:
    send_mail(
        to,
        "Invitación a Reforesta Radar",
        f"Te han invitado a Reforesta Radar.\n\nCrea tu cuenta con este enlace (caduca en 7 días, un solo uso):\n"
        f"{link}\n\nSi no esperabas este correo, ignóralo.\n",
    )


def reset_mail(to: str, link: str) -> None:
    send_mail(
        to,
        "Restablecer la contraseña de Reforesta Radar",
        f"Para elegir una contraseña nueva abre este enlace (caduca en 24 horas, un solo uso):\n{link}\n\n"
        "Si no lo has pedido tú, ignora este correo: tu contraseña no cambia.\n",
    )
