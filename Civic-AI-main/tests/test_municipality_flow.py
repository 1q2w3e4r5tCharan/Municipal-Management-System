import os
import time
from src import db


def test_ticket_number_generation_for_municipality():
    # initialize DB (idempotent)
    db.init_db()
    # clear tickets and counters for deterministic test
    conn = db._get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM tickets")
    cur.execute("DELETE FROM counters")
    conn.commit()
    conn.close()

    # create a ticket scoped to Visakhapatnam (VSP)
    ticket = {
        'label': 'pothole',
        'confidence': 0.9,
        'priority': 0.5,
        'department': 'engineering',
        'department_label': 'Engineering',
        'description': 'Test pothole',
        'state': 'AP',
        'municipality': 'VSP',
        'metadata': {}
    }
    created = db.create_ticket(ticket)
    assert created is not None
    assert 'ticket_number' in created
    assert created['ticket_number'].startswith('CIV-AP-VSP-')


def test_staff_creation_and_assignment():
    db.init_db()
    # create staff in VSP
    staff = db.create_staff('Test Staff', role='Field Worker', department='engineering', municipality='VSP', phone='+919876543210', email='staff@example.com')
    assert staff is not None
    assert staff.get('municipality') == 'VSP'

    # create ticket and assign
    ticket = db.create_ticket({
        'label': 'trash',
        'confidence': 0.8,
        'priority': 0.4,
        'department': 'solid_waste',
        'department_label': 'Solid Waste',
        'description': 'Trash dumping test',
        'state': 'AP',
        'municipality': 'VSP',
        'metadata': {}
    })
    assert ticket is not None
    assign = db.create_assignment(ticket['id'], staff['name'], staff['email'], assigned_by='tester')
    assert assign is not None
    # fetch ticket and check metadata assignee
    t = db.get_ticket(ticket['id'])
    assert t is not None
    assert t['metadata'].get('assignee') is not None