import sqlite3
import json
import time
from pathlib import Path
import uuid
from .departments import get_email_for

DB_PATH = Path(__file__).resolve().parents[1] / 'data.db'


def _get_conn():
    # use a file-based sqlite DB in project root
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            ticket_number TEXT,
            country TEXT,
            state TEXT,
            district TEXT,
            municipality TEXT,
            phone TEXT,
            ward TEXT,
            consent INTEGER,
            label TEXT,
            confidence REAL,
            priority REAL,
            department TEXT,
            department_label TEXT,
            status TEXT,
            created_at INTEGER,
            description TEXT,
            metadata TEXT
        )
        '''
    )
    # messages table for contact form submissions
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            ticket_id TEXT,
            department TEXT,
            sender_name TEXT,
            sender_email TEXT,
            message TEXT,
            created_at INTEGER
        )
        '''
    )
    # assignments table: records when a staff member is assigned to a ticket
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS assignments (
            id TEXT PRIMARY KEY,
            ticket_id TEXT,
            staff_name TEXT,
            staff_email TEXT,
            assigned_by TEXT,
            note TEXT,
            created_at INTEGER
        )
        '''
    )
    # schedules table: scheduled maintenance/service entries
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            ticket_id TEXT,
            schedule_date TEXT,
            schedule_type TEXT,
            notes TEXT,
            scheduled_by TEXT,
            created_at INTEGER
        )
        '''
    )
    # staff table for municipal staff directory
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS staff (
            id TEXT PRIMARY KEY,
            name TEXT,
            role TEXT,
            department TEXT,
            municipality TEXT,
            phone TEXT,
            email TEXT,
            status TEXT,
            current_load INTEGER,
            created_at INTEGER
        )
        '''
    )
    # counters table to provide atomic sequential ticket numbers per-department
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS counters (
            name TEXT PRIMARY KEY,
            value INTEGER
        )
        '''
    )
    # users table for simple account/OTP prototype
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT,
            email TEXT UNIQUE,
            password_hash TEXT,
            verified INTEGER,
            created_at INTEGER
        )
        '''
    )
    # otp_codes table stores temporary OTPs for verification
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS otp_codes (
            id TEXT PRIMARY KEY,
            email TEXT,
            code TEXT,
            expires_at INTEGER,
            created_at INTEGER
        )
        '''
    )
    conn.commit()
    # Ensure ticket_number column exists for older DBs: add if missing
    try:
        cur.execute("PRAGMA table_info(tickets)")
        cols = [r['name'] for r in cur.fetchall()]
        # Add any new columns we introduced if they are missing (idempotent)
        if 'ticket_number' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN ticket_number TEXT')
            conn.commit()
            cols.append('ticket_number')
        if 'country' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN country TEXT')
            conn.commit()
        if 'state' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN state TEXT')
            conn.commit()
        if 'district' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN district TEXT')
            conn.commit()
        if 'municipality' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN municipality TEXT')
            conn.commit()
        if 'phone' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN phone TEXT')
            conn.commit()
        if 'ward' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN ward TEXT')
            conn.commit()
        if 'consent' not in cols:
            cur.execute('ALTER TABLE tickets ADD COLUMN consent INTEGER')
            conn.commit()
        # Ensure staff table has municipality column
        cur.execute("PRAGMA table_info(staff)")
        staff_cols = [r['name'] for r in cur.fetchall()]
        if 'municipality' not in staff_cols:
            cur.execute('ALTER TABLE staff ADD COLUMN municipality TEXT')
            conn.commit()
    except Exception:
        # non-fatal: ignore
        pass
    conn.close()


def create_ticket(ticket: dict) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    ticket_id = ticket.get('id') or str(uuid.uuid4())
    now = int(ticket.get('created_at') or time.time())
    meta = ticket.get('metadata') or {}
    # Compute a safe per-department sequential number using a counters table in a transaction
    ticket_number = None
    try:
        dept_label = (ticket.get('department_label') or ticket.get('department') or 'GEN').upper()
        dept_code = ''.join([c for c in dept_label if c.isalnum()])[:6] or 'GEN'
        # state and municipality scoping for counters
        state = (ticket.get('state') or 'AP').upper()
        municipality = (ticket.get('municipality') or (meta.get('municipality') if isinstance(meta, dict) else None) or 'GEN').upper()
        muni_code = ''.join([c for c in municipality if c.isalnum()])[:6] or 'GEN'
        # Attempt an update-then-insert flow which avoids explicit BEGIN statements
        # counter key is state:municipality:department to ensure uniqueness per-municipality
        counter_key = f"{state}:{muni_code}:{dept_code}"
        cur.execute('UPDATE counters SET value = value + 1 WHERE name = ?', (counter_key,))
        if cur.rowcount == 0:
            # no existing counter, insert initial value 1
            cur.execute('INSERT INTO counters(name, value) VALUES (?, ?)', (counter_key, 1))
            next_val = 1
        else:
            # fetch the incremented value
            cur.execute('SELECT value FROM counters WHERE name = ?', (counter_key,))
            row = cur.fetchone()
            try:
                next_val = int(row['value'])
            except Exception:
                next_val = 1
        ticket_number = f"CIV-{state}-{muni_code}-{int(next_val):05d}"
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        ticket_number = None

    # Insert ticket row with computed ticket_number (if available)
    cur.execute(
        'INSERT INTO tickets(id, ticket_number, country, state, district, municipality, phone, ward, consent, label, confidence, priority, department, department_label, status, created_at, description, metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (
            ticket_id,
            ticket_number,
            ticket.get('country') or 'IN',
            ticket.get('state') or state,
            ticket.get('district'),
            ticket.get('municipality') or municipality,
            ticket.get('phone'),
            ticket.get('ward'),
            int(bool(ticket.get('consent'))),
            ticket.get('label'),
            float(ticket.get('confidence') or 0.0),
            float(ticket.get('priority') or 0.0),
            ticket.get('department'),
            ticket.get('department_label'),
            ticket.get('status') or 'Submitted',
            now,
            ticket.get('description') or '',
            json.dumps(meta),
        ),
    )
    try:
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    # fetch back
    cur.execute('SELECT * FROM tickets WHERE id=?', (ticket_id,))
    row = cur.fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def create_user(name: str, email: str, password_hash: str = None, verified: bool = False) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    uid = str(uuid.uuid4())
    now = int(time.time())
    try:
        cur.execute(
            'INSERT INTO users(id, name, email, password_hash, verified, created_at) VALUES (?,?,?,?,?,?)',
            (uid, name, email, password_hash, int(bool(verified)), now),
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    cur.execute('SELECT * FROM users WHERE id=?', (uid,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_email(email: str) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute('SELECT * FROM users WHERE email=?', (email,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user(user_id: str) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute('SELECT * FROM users WHERE id=?', (user_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def update_user_email(user_id: str, new_email: str) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute('UPDATE users SET email=?, verified=? WHERE id=?', (new_email, 0, user_id))
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    cur.execute('SELECT * FROM users WHERE id=?', (user_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def save_otp(email: str, code: str, expires_at: int) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    oid = str(uuid.uuid4())
    now = int(time.time())
    cur.execute('INSERT INTO otp_codes(id, email, code, expires_at, created_at) VALUES (?,?,?,?,?)', (oid, email, code, int(expires_at), now))
    conn.commit()
    cur.execute('SELECT * FROM otp_codes WHERE id=?', (oid,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def verify_otp(email: str, code: str) -> bool:
    conn = _get_conn()
    cur = conn.cursor()
    now = int(time.time())
    cur.execute('SELECT * FROM otp_codes WHERE email=? AND code=? AND expires_at>=? ORDER BY created_at DESC LIMIT 1', (email, code, now))
    row = cur.fetchone()
    if not row:
        conn.close()
        return False
    # mark user verified if exists
    try:
        cur.execute('UPDATE users SET verified=? WHERE email=?', (1, email))
        # remove used OTPs for this email
        cur.execute('DELETE FROM otp_codes WHERE email=?', (email,))
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
    conn.close()
    return True


def get_ticket(ticket_id: str) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute('SELECT * FROM tickets WHERE id=?', (ticket_id,))
    row = cur.fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def list_tickets(state: str = None, municipality: str = None, department: str = None) -> list:
    """Return tickets. Optional filters: state, municipality, department.

    Parameters are case-insensitive codes/strings. If provided, they are applied as filters
    against the corresponding columns in the `tickets` table.
    """
    conn = _get_conn()
    cur = conn.cursor()
    clauses = []
    params = []
    if state:
        clauses.append('UPPER(state)=?')
        params.append(state.upper())
    if municipality:
        clauses.append('UPPER(municipality)=?')
        params.append(municipality.upper())
    if department:
        clauses.append('department=?')
        params.append(department)

    sql = 'SELECT * FROM tickets'
    if clauses:
        sql = sql + ' WHERE ' + ' AND '.join(clauses)

    cur.execute(sql, tuple(params))
    rows = cur.fetchall()
    conn.close()
    return [_row_to_dict(r) for r in rows]


def clear_tickets():
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM tickets')
    conn.commit()
    conn.close()


def save_contact_message(msg: dict) -> dict:
    """Save a contact message from the UI into the messages table.
    Expects keys: ticket_id, department, sender_name, sender_email, message
    """
    conn = _get_conn()
    cur = conn.cursor()
    mid = msg.get('id') or str(uuid.uuid4())
    now = int(time.time())
    cur.execute(
        'INSERT INTO messages(id, ticket_id, department, sender_name, sender_email, message, created_at) VALUES (?,?,?,?,?,?,?)',
        (
            mid,
            msg.get('ticket_id'),
            msg.get('department'),
            msg.get('sender_name'),
            msg.get('sender_email'),
            msg.get('message'),
            now,
        ),
    )
    conn.commit()
    cur.execute('SELECT * FROM messages WHERE id=?', (mid,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    try:
        d['created_at'] = float(d.get('created_at') or 0)
    except Exception:
        d['created_at'] = 0.0
    return d


def list_messages() -> list:
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute('SELECT * FROM messages ORDER BY created_at DESC')
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_assignment(ticket_id: str, staff_name: str, staff_email: str, assigned_by: str = None, note: str = None) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    aid = str(uuid.uuid4())
    now = int(time.time())
    cur.execute(
        'INSERT INTO assignments(id, ticket_id, staff_name, staff_email, assigned_by, note, created_at) VALUES (?,?,?,?,?,?,?)',
        (aid, ticket_id, staff_name, staff_email, assigned_by, note, now)
    )
    # update ticket status and metadata to record last assignee
    try:
        cur.execute('SELECT metadata FROM tickets WHERE id=?', (ticket_id,))
        row = cur.fetchone()
        meta = {}
        if row:
            try:
                meta = json.loads(row['metadata'] or '{}')
            except Exception:
                meta = {}
        meta['assignee'] = {'name': staff_name, 'email': staff_email, 'assigned_by': assigned_by, 'assigned_at': now}
        cur.execute('UPDATE tickets SET status=?, metadata=? WHERE id=?', ('Assigned', json.dumps(meta), ticket_id))
    except Exception:
        pass
    conn.commit()
    cur.execute('SELECT * FROM assignments WHERE id=?', (aid,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def list_assignments(ticket_id: str = None) -> list:
    conn = _get_conn()
    cur = conn.cursor()
    if ticket_id:
        cur.execute('SELECT * FROM assignments WHERE ticket_id=? ORDER BY created_at DESC', (ticket_id,))
    else:
        cur.execute('SELECT * FROM assignments ORDER BY created_at DESC')
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_schedule(ticket_id: str, schedule_date: str, schedule_type: str = None, notes: str = None, scheduled_by: str = None) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    sid = str(uuid.uuid4())
    now = int(time.time())
    cur.execute(
        'INSERT INTO schedules(id, ticket_id, schedule_date, schedule_type, notes, scheduled_by, created_at) VALUES (?,?,?,?,?,?,?)',
        (sid, ticket_id, schedule_date, schedule_type, notes, scheduled_by, now)
    )
    # update ticket status to Scheduled
    try:
        cur.execute('SELECT metadata FROM tickets WHERE id=?', (ticket_id,))
        row = cur.fetchone()
        meta = {}
        if row:
            try:
                meta = json.loads(row['metadata'] or '{}')
            except Exception:
                meta = {}
        meta.setdefault('schedules', []).append({'id': sid, 'date': schedule_date, 'type': schedule_type, 'notes': notes, 'scheduled_by': scheduled_by, 'created_at': now})
        cur.execute('UPDATE tickets SET status=?, metadata=? WHERE id=?', ('Scheduled', json.dumps(meta), ticket_id))
    except Exception:
        pass
    conn.commit()
    cur.execute('SELECT * FROM schedules WHERE id=?', (sid,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def list_schedules(ticket_id: str = None) -> list:
    conn = _get_conn()
    cur = conn.cursor()
    if ticket_id:
        cur.execute('SELECT * FROM schedules WHERE ticket_id=? ORDER BY created_at DESC', (ticket_id,))
    else:
        cur.execute('SELECT * FROM schedules ORDER BY created_at DESC')
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_staff(name: str, role: str = None, department: str = None, municipality: str = None, phone: str = None, email: str = None, status: str = 'Active', current_load: int = 0) -> dict:
    conn = _get_conn()
    cur = conn.cursor()
    sid = str(uuid.uuid4())
    now = int(time.time())
    cur.execute(
        'INSERT INTO staff(id, name, role, department, municipality, phone, email, status, current_load, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        (sid, name, role, department, municipality, phone, email, status, int(current_load or 0), now)
    )
    conn.commit()
    cur.execute('SELECT * FROM staff WHERE id=?', (sid,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def list_staff() -> list:
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute('SELECT * FROM staff ORDER BY name ASC')
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _row_to_dict(row: sqlite3.Row) -> dict:
    if row is None:
        return None
    d = dict(row)
    # expose ticket_number if present
    if 'ticket_number' in d and d.get('ticket_number'):
        d['ticket_number'] = d.get('ticket_number')
    # attach department email if possible
    try:
        d['department_email'] = get_email_for(d.get('department'), d.get('department_label'))
    except Exception:
        d['department_email'] = None
    try:
        d['metadata'] = json.loads(d.get('metadata') or '{}')
    except Exception:
        d['metadata'] = {}
    # convert created_at to float seconds
    try:
        d['created_at'] = float(d.get('created_at') or 0)
    except Exception:
        d['created_at'] = 0.0
    return d
