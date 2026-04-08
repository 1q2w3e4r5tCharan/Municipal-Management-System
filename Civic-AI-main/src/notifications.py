import os
import smtplib
import ssl
from email.message import EmailMessage
from typing import List, Optional

from .departments import get_email_for


def _get_smtp_config():
    return {
        'host': os.environ.get('SMTP_HOST'),
        'port': int(os.environ.get('SMTP_PORT', '0')) if os.environ.get('SMTP_PORT') else None,
        'user': os.environ.get('SMTP_USER'),
        'password': os.environ.get('SMTP_PASS'),
        'from_email': os.environ.get('FROM_EMAIL', 'no-reply@example.com'),
        'use_tls': os.environ.get('SMTP_USE_TLS', 'true').lower() in ('1', 'true', 'yes'),
        'public_list': [e.strip() for e in (os.environ.get('PUBLIC_NOTIFICATION_LIST') or '').split(',') if e.strip()],
    }


def send_email(to: List[str], subject: str, body: str, cc: Optional[List[str]] = None) -> bool:
    cfg = _get_smtp_config()
    if not cfg.get('host') or not cfg.get('port'):
        # SMTP not configured; skip sending in dev
        print('SMTP not configured; skipping send_email:', subject)
        return False

    msg = EmailMessage()
    msg['From'] = cfg.get('from_email')
    msg['To'] = ', '.join(to)
    if cc:
        msg['Cc'] = ', '.join(cc)
    msg['Subject'] = subject
    msg.set_content(body)

    try:
        if cfg.get('use_tls'):
            context = ssl.create_default_context()
            with smtplib.SMTP(cfg['host'], cfg['port']) as server:
                server.starttls(context=context)
                if cfg.get('user') and cfg.get('password'):
                    server.login(cfg['user'], cfg['password'])
                server.send_message(msg)
        else:
            with smtplib.SMTP(cfg['host'], cfg['port']) as server:
                if cfg.get('user') and cfg.get('password'):
                    server.login(cfg['user'], cfg['password'])
                server.send_message(msg)
        print('Email sent:', subject, 'to', to)
        return True
    except Exception as e:
        print('Failed to send email:', e)
        return False


def notify_new_ticket(ticket: dict):
    """Notify municipal department and public mailing list about a new ticket."""
    try:
        dept = ticket.get('department')
        dept_label = ticket.get('department_label')
        dept_email = None
        try:
            dept_email = get_email_for(dept, dept_label)
        except Exception:
            dept_email = None

        cfg = _get_smtp_config()
        public = cfg.get('public_list') or []

        subject = f"New ticket: {ticket.get('ticket_number') or ticket.get('id')} - {dept_label or dept}"
        body_lines = [
            f"Ticket ID: {ticket.get('ticket_number') or ticket.get('id')}",
            f"Category: {ticket.get('label')} (confidence={ticket.get('confidence')})",
            f"Priority: {ticket.get('priority')}",
            f"Department: {dept_label} <{dept}>",
            f"Municipality: {ticket.get('municipality')}",
            f"Description: {ticket.get('description')}",
        ]
        if ticket.get('phone'):
            body_lines.append(f"Reporter phone: {ticket.get('phone')}")
        # reporter email may be in metadata.reporter_email
        try:
            reporter_email = ticket.get('metadata', {}).get('reporter_email')
            if reporter_email:
                body_lines.append(f"Reporter email: {reporter_email}")
        except Exception:
            reporter_email = None

        body = '\n'.join([l for l in body_lines if l])

        recipients = []
        if dept_email:
            recipients.append(dept_email)
        # send to public list too
        cc = public if public else None
        if not recipients and not cc:
            # nothing to send
            print('No recipients for notify_new_ticket')
            return False

        # prefer sending to department and CC public
        to = recipients or (public if public else [])
        return send_email(to=to, subject=subject, body=body, cc=cc)
    except Exception as e:
        print('notify_new_ticket error:', e)
        return False


def notify_ticket_update(ticket: dict, update_type: str, detail: Optional[dict] = None):
    """Notify department and public list about ticket updates (assignment, schedule, status change)."""
    try:
        dept = ticket.get('department')
        dept_label = ticket.get('department_label')
        dept_email = None
        try:
            dept_email = get_email_for(dept, dept_label)
        except Exception:
            dept_email = None

        cfg = _get_smtp_config()
        public = cfg.get('public_list') or []

        subject = f"Ticket update: {ticket.get('ticket_number') or ticket.get('id')} - {update_type}"
        body_lines = [
            f"Ticket ID: {ticket.get('ticket_number') or ticket.get('id')}",
            f"Update type: {update_type}",
            f"Department: {dept_label} <{dept}>",
            f"Municipality: {ticket.get('municipality')}",
            f"Current status: {ticket.get('status')}",
        ]
        if isinstance(detail, dict):
            body_lines.append('Details:')
            for k, v in detail.items():
                body_lines.append(f"  {k}: {v}")

        body = '\n'.join(body_lines)

        recipients = []
        if dept_email:
            recipients.append(dept_email)
        cc = public if public else None
        if not recipients and not cc:
            print('No recipients for notify_ticket_update')
            return False
        to = recipients or (public if public else [])
        return send_email(to=to, subject=subject, body=body, cc=cc)
    except Exception as e:
        print('notify_ticket_update error:', e)
        return False


def notify_contact_message(saved: dict):
    """Send contact form messages to department email and optionally public list."""
    try:
        dept = saved.get('department')
        dept_label = None
        try:
            # try to derive label from departments mapping by passing None for label
            dept_label = None
            dept_email = get_email_for(dept, dept_label)
        except Exception:
            dept_email = None

        cfg = _get_smtp_config()
        public = cfg.get('public_list') or []

        subject = f"Contact message regarding {saved.get('ticket_id') or 'general'}"
        body_lines = [
            f"Ticket ID: {saved.get('ticket_id')}",
            f"Department: {dept}",
            f"Sender: {saved.get('sender_name')} <{saved.get('sender_email')}>",
            f"Message: {saved.get('message')}",
        ]
        body = '\n'.join(body_lines)

        recipients = []
        if dept_email:
            recipients.append(dept_email)
        cc = public if public else None
        if not recipients and not cc:
            print('No recipients for notify_contact_message')
            return False
        to = recipients or (public if public else [])
        return send_email(to=to, subject=subject, body=body, cc=cc)
    except Exception as e:
        print('notify_contact_message error:', e)
        return False
