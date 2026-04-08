from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, Depends, BackgroundTasks
# Load .env automatically for local development (optional)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    # dotenv not installed; continue without .env
    pass
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import BaseModel
from typing import Optional, List
import uuid
import time
import secrets
import hashlib
import os

from .classifier import classify_image, classify_text
from .router import route
from .score import compute_priority
from . import db
from .gemini_client import analyze_text as gemini_analyze_text, analyze_image as gemini_analyze_image
from . import notifications
import asyncio
import json
from fastapi.responses import StreamingResponse

# simple in-memory cooldown map to throttle OTP resends in dev/prototype
# maps email -> unix timestamp of last OTP sent
LAST_OTP_SENT = {}
OTP_RESEND_COOLDOWN = int(os.environ.get('OTP_RESEND_COOLDOWN', '60'))  # seconds

# Simple in-process SSE subscriber set. Each subscriber is an asyncio.Queue
SUBSCRIBERS = set()

app = FastAPI(title="AI Civic Agent Prototype")

# CORS (prototype) - allow frontend served from same host or other dev hosts
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static frontend (index.html, app.js, style.css) from the project root
ROOT_DIR = Path(__file__).resolve().parents[1]
# Mount static files under /static to avoid interfering with API routes
app.mount("/static", StaticFiles(directory=str(ROOT_DIR), html=True), name="static")


@app.get("/")
def serve_index():
    idx = ROOT_DIR / 'index.html'
    if idx.exists():
        return FileResponse(str(idx))
    return {"status": "ok"}

# initialize DB-backed store


@app.on_event('startup')
def startup_event():
    db.init_db()


class TicketOut(BaseModel):
    id: str
    ticket_number: Optional[str] = None
    label: str
    confidence: float
    priority: float
    department: str
    department_label: str
    country: Optional[str] = None
    state: Optional[str] = None
    municipality: Optional[str] = None
    phone: Optional[str] = None
    ward: Optional[str] = None
    consent: Optional[int] = None
    description: Optional[str]
    metadata: dict
    created_at: float


class ContactIn(BaseModel):
    ticket_id: Optional[str]
    department: Optional[str]
    sender_name: Optional[str]
    sender_email: Optional[str]
    message: str


class AssignIn(BaseModel):
    ticket_id: str
    staff_name: str
    staff_email: Optional[str] = None
    assigned_by: Optional[str] = None
    note: Optional[str] = None


class ScheduleIn(BaseModel):
    ticket_id: str
    schedule_date: str  # ISO string or human-friendly
    schedule_type: Optional[str] = None
    notes: Optional[str] = None
    scheduled_by: Optional[str] = None


class StaffIn(BaseModel):
    name: str
    role: Optional[str] = None
    department: Optional[str] = None
    municipality: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = 'Active'
    current_load: Optional[int] = 0


class UserCreate(BaseModel):
    name: Optional[str]
    email: str
    password: Optional[str] = None


class OTPVerify(BaseModel):
    email: str
    code: str


class UpdateEmail(BaseModel):
    user_id: str
    new_email: str


class ResendOTP(BaseModel):
    email: str


class TestEmail(BaseModel):
    to: List[str]
    subject: Optional[str] = 'Test message'
    body: Optional[str] = 'This is a test email from AI Civic Agent prototype.'


@app.post('/contact')
def contact_submit(payload: ContactIn, background_tasks: BackgroundTasks):
    """Receive a contact message from the frontend and store it.
    This is a dev-friendly endpoint: it stores the message and returns the saved record
    and the department email the message would be sent to. Integrate SMTP here when
    moving to production.
    """
    data = payload.dict()
    saved = db.save_contact_message(data)
    # look up department email
    dept_email = None
    try:
        from .departments import get_email_for
        dept_email = get_email_for(data.get('department'), None)
    except Exception:
        dept_email = None
    # send contact notification in background (best-effort)
    try:
        background_tasks.add_task(notifications.notify_contact_message, saved)
    except Exception:
        pass

    return { 'status': 'ok', 'saved': saved, 'department_email': dept_email }


@app.post('/user/create')
def user_create(payload: UserCreate, background_tasks: BackgroundTasks):
    """Create a user account (dev: no auth). Sends an OTP to the provided email for verification."""
    data = payload.dict()
    email = data.get('email')
    name = data.get('name') or ''
    password = data.get('password')
    # store password hash if provided
    pwd_hash = None
    if password:
        pwd_hash = hashlib.sha256(password.encode('utf-8')).hexdigest()
    # create user record
    try:
        created = db.create_user(name=name, email=email, password_hash=pwd_hash, verified=False)
    except Exception:
        created = None
    if not created:
        raise HTTPException(status_code=500, detail='Could not create user (maybe email exists)')
    # generate OTP
    code = '{:06d}'.format(secrets.randbelow(1000000))
    expires = int(time.time()) + 10 * 60
    try:
        db.save_otp(email, code, expires)
    except Exception:
        pass
    # send OTP email in background (best-effort)
    sent = False
    try:
        subject = 'Your verification code'
        body = f'Hello {name or "user"},\n\nYour verification code is: {code}\nIt expires in 10 minutes.'
        # attempt to send in background
        try:
            background_tasks.add_task(notifications.send_email, [email], subject, body)
            sent = True
        except Exception:
            sent = False
    except Exception:
        sent = False
    # don't return password hash
    created.pop('password_hash', None)
    resp = {'status': 'ok', 'user': created}
    # If SMTP not configured or DEBUG flag set, return OTP in response to allow fast dev flow
    dev_return = os.environ.get('DEV_RETURN_OTP', os.environ.get('DEBUG', 'false')).lower() in ('1', 'true', 'yes')
    smtp_host = os.environ.get('SMTP_HOST')
    if dev_return or not smtp_host or not sent:
        # include OTP in response for local/dev/hackathon usage only
        resp['dev_otp'] = code
        resp['note'] = 'OTP returned in response because SMTP not configured or DEV_RETURN_OTP enabled.'
    return resp


@app.post('/user/verify-otp')
def user_verify(payload: OTPVerify):
    ok = db.verify_otp(payload.email, payload.code)
    if not ok:
        raise HTTPException(status_code=400, detail='Invalid or expired code')
    user = db.get_user_by_email(payload.email)
    if user:
        user.pop('password_hash', None)
    return {'status': 'ok', 'verified': True, 'user': user}


@app.post('/user/update-email')
def user_update_email(payload: UpdateEmail, background_tasks: BackgroundTasks):
    user = db.get_user(payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    old_email = user.get('email')
    new_email = payload.new_email
    updated = db.update_user_email(payload.user_id, new_email)
    # notify both old and new emails about the change
    try:
        subject = 'Your account email has been changed'
        body_old = f'Hello {user.get("name") or "user"},\n\nYour account email has been changed from {old_email} to {new_email}. If you did not request this, contact support.'
        body_new = f'Hello {user.get("name") or "user"},\n\nThis email ({new_email}) was just added to an account (user id {payload.user_id}). If you did not request this, contact support.'
        if old_email:
            background_tasks.add_task(notifications.send_email, [old_email], subject, body_old)
        background_tasks.add_task(notifications.send_email, [new_email], subject, body_new)
    except Exception:
        pass
    if updated:
        updated.pop('password_hash', None)
    return {'status': 'ok', 'user': updated}


@app.post('/user/resend-otp')
def user_resend_otp(payload: ResendOTP, background_tasks: BackgroundTasks):
    """Generate and resend an OTP for an existing user.
    Returns dev_otp in response when DEV_RETURN_OTP or SMTP is not configured (dev-only).
    """
    email = payload.email
    user = db.get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    # If already verified, no need to resend
    if int(user.get('verified') or 0) == 1:
        user.pop('password_hash', None)
        return {'status': 'ok', 'verified': True, 'note': 'User already verified', 'user': user}

    # throttle: simple in-memory cooldown
    now = int(time.time())
    last = LAST_OTP_SENT.get(email)
    if last and now - int(last) < OTP_RESEND_COOLDOWN:
        retry_after = OTP_RESEND_COOLDOWN - (now - int(last))
        raise HTTPException(status_code=429, detail=f"Too many requests: try again in {retry_after} seconds")

    # generate OTP
    code = '{:06d}'.format(secrets.randbelow(1000000))
    expires = int(time.time()) + 10 * 60
    try:
        db.save_otp(email, code, expires)
    except Exception:
        pass

    # attempt to send email in background
    sent = False
    try:
        subject = 'Your verification code'
        body = f'Hello,\n\nYour verification code is: {code}\nIt expires in 10 minutes.'
        try:
            background_tasks.add_task(notifications.send_email, [email], subject, body)
            sent = True
        except Exception:
            sent = False
    except Exception:
        sent = False

    resp = {'status': 'ok'}
    # record last sent timestamp on success (or even if not sent to avoid rapid retries)
    LAST_OTP_SENT[email] = int(time.time())
    dev_return = os.environ.get('DEV_RETURN_OTP', os.environ.get('DEBUG', 'false')).lower() in ('1', 'true', 'yes')
    smtp_host = os.environ.get('SMTP_HOST')
    if dev_return or not smtp_host or not sent:
        resp['dev_otp'] = code
        resp['note'] = 'OTP returned in response because SMTP not configured or DEV_RETURN_OTP enabled.'
    return resp


@app.post('/debug/send-test-email')
def debug_send_test_email(payload: TestEmail):
    """Send a test email synchronously and return the result.
    Intended for local/dev testing only. Do not expose in production.
    """
    # send synchronously so caller can see result immediately
    try:
        ok = notifications.send_email(payload.to, payload.subject, payload.body)
        return {'sent': bool(ok)}
    except Exception as e:
        # return the error message for debugging in dev
        return {'sent': False, 'error': str(e)}


def require_municipal(request: Request):
    """Simple prototype guard: require header 'x-user-role: municipal' to allow municipal operations."""
    role = request.headers.get('x-user-role') or request.headers.get('X-User-Role')
    if not role or role.lower() != 'municipal':
        raise HTTPException(status_code=403, detail='municipal role required')
    return True


@app.post('/assign')
def assign_ticket(payload: AssignIn, allowed: bool = Depends(require_municipal), background_tasks: BackgroundTasks = None):
    """Assign a ticket to a staff member. Stores an assignment record and updates ticket status/metadata."""
    data = payload.dict()
    saved = db.create_assignment(data.get('ticket_id'), data.get('staff_name'), data.get('staff_email'), data.get('assigned_by'), data.get('note'))
    if not saved:
        raise HTTPException(status_code=500, detail='Could not create assignment')
    # return updated ticket
    ticket = db.get_ticket(data.get('ticket_id'))
    # notify stakeholders about assignment (background)
    try:
        if background_tasks is not None:
            background_tasks.add_task(notifications.notify_ticket_update, ticket, 'assigned', saved)
    except Exception:
        pass
    return { 'status': 'ok', 'assignment': saved, 'ticket': ticket }


@app.get('/ticket/{ticket_id}/assignments')
def get_ticket_assignments(ticket_id: str):
    return db.list_assignments(ticket_id)


@app.post('/schedule')
def schedule_work(payload: ScheduleIn, allowed: bool = Depends(require_municipal), background_tasks: BackgroundTasks = None):
    """Schedule maintenance/service for a ticket. Stores schedule and updates ticket status."""
    data = payload.dict()
    saved = db.create_schedule(data.get('ticket_id'), data.get('schedule_date'), data.get('schedule_type'), data.get('notes'), data.get('scheduled_by'))
    if not saved:
        raise HTTPException(status_code=500, detail='Could not create schedule')
    ticket = db.get_ticket(data.get('ticket_id'))
    # notify stakeholders about schedule (background)
    try:
        if background_tasks is not None:
            background_tasks.add_task(notifications.notify_ticket_update, ticket, 'scheduled', saved)
    except Exception:
        pass
    return { 'status': 'ok', 'schedule': saved, 'ticket': ticket }


@app.get('/ticket/{ticket_id}/schedules')
def get_ticket_schedules(ticket_id: str):
    return db.list_schedules(ticket_id)


@app.post('/staff')
def create_staff(payload: StaffIn, allowed: bool = Depends(require_municipal)):
    """Create a staff member in the municipal directory (dev-only: protected by header guard)."""
    data = payload.dict()
    saved = db.create_staff(data.get('name'), data.get('role'), data.get('department'), data.get('municipality'), data.get('phone'), data.get('email'), data.get('status'), data.get('current_load'))
    if not saved:
        raise HTTPException(status_code=500, detail='Could not create staff')
    return { 'status': 'ok', 'staff': saved }


@app.get('/staff')
def list_staff():
    """Return the municipal staff directory."""
    return db.list_staff()


@app.get('/messages')
def list_messages():
    """Dev-only: list recent contact messages stored in the DB."""
    return db.list_messages()


@app.post("/report", response_model=TicketOut)
async def submit_report(description: Optional[str] = Form(None), image: UploadFile = File(None), category: Optional[str] = Form(None), municipality: Optional[str] = Form(None), state: Optional[str] = Form('AP'), phone: Optional[str] = Form(None), ward: Optional[str] = Form(None), consent: Optional[bool] = Form(False), background_tasks: BackgroundTasks = None):
    """Accept a citizen report with optional image and text. Returns a processed ticket.
    This endpoint runs the classifier stubs, computes priority, and routes the ticket.
    """
    image_bytes = None
    image_meta = {}
    if image is not None:
        try:
            image_bytes = await image.read()
        except Exception:
            raise HTTPException(status_code=400, detail="Could not read image")

    # classify text first
    text_label, text_conf, text_meta = classify_text(description or "")

    # classify image if present
    img_label, img_conf, img_meta = ("other", 0.2, {})
    if image_bytes:
        img_label, img_conf, img_meta = classify_image(image_bytes)

    # simple fusion: prefer text if confidence high, otherwise image
    if text_conf >= 0.8:
        label, confidence = text_label, text_conf
    else:
        # pick whichever has higher confidence
        if img_conf >= text_conf:
            label, confidence = img_label, img_conf
        else:
            label, confidence = text_label, text_conf

    # if user selected a category in the UI, prefer that (treat as high confidence)
    if category:
        label = category
        confidence = max(confidence, 0.95)

    # compute priority
    priority = compute_priority(label, confidence, text=description or "", image_meta=img_meta)

    # routing
    dept_id, dept_label = route(label)

    ticket_id = str(uuid.uuid4())
    ticket = {
        "id": ticket_id,
        "label": label,
        "confidence": confidence,
        "priority": priority,
        "department": dept_id,
        "department_label": dept_label,
        "description": description,
        "metadata": {**img_meta, **text_meta, 'location': None},
        "country": 'IN',
        "state": (state or 'AP'),
        "municipality": (municipality or 'GEN'),
        "phone": phone,
        "ward": ward,
        "consent": int(bool(consent)),
        "created_at": time.time(),
    }

    try:
        created = db.create_ticket(ticket)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        return JSONResponse(status_code=500, content={"error": str(e), "trace": tb})
    # If DB create fails, return error details for debugging in dev
    if not created:
        return JSONResponse(status_code=500, content={"error": "create_ticket returned None"})
    # notify SSE subscribers about new ticket
    try:
        for q in list(SUBSCRIBERS):
            # best-effort, don't block
            try:
                q.put_nowait(created)
            except Exception:
                # ignore if queue closed
                pass
    except Exception:
        pass
    # send email notifications in background (municipality + public list)
    try:
        if background_tasks is not None:
            background_tasks.add_task(notifications.notify_new_ticket, created)
        else:
            # fallback: fire-and-forget thread for environments without BackgroundTasks
            try:
                import threading
                threading.Thread(target=notifications.notify_new_ticket, args=(created,), daemon=True).start()
            except Exception:
                pass
    except Exception:
        pass
    return JSONResponse(status_code=200, content=created)


class AIAnalyzeIn(BaseModel):
    description: Optional[str] = None


@app.post('/ai/analyze')
async def ai_analyze(description: Optional[str] = Form(None), image: UploadFile = File(None)):
    """
    Analyze text or an uploaded image with the configured Gemini / Generative model when available.

    Request: multipart/form-data with either `description` (text) or `image` (file) or both.
    Response: JSON with `label`, `confidence`, `explanation`, and `source`.
    """
    image_bytes = None
    if image is not None:
        try:
            image_bytes = await image.read()
        except Exception:
            raise HTTPException(status_code=400, detail="Could not read image")

    # Prefer image analysis if image present
    if image_bytes:
        result = gemini_analyze_image(image_bytes)
    elif description:
        result = gemini_analyze_text(description)
    else:
        raise HTTPException(status_code=400, detail="Provide `description` or `image` for analysis")

    # Try to compute a priority score server-side for more accurate UI display
    try:
        # label and confidence expected in result
        lbl = result.get('label') if isinstance(result, dict) else None
        conf = float(result.get('confidence', 0.0)) if isinstance(result, dict) else 0.0
        # try to parse explanation as image metadata if available
        img_meta = {}
        explanation = result.get('explanation', '') if isinstance(result, dict) else ''
        try:
            # explanation can be a JSON string when coming from local image classifier
            if explanation and isinstance(explanation, str):
                parsed = json.loads(explanation)
                if isinstance(parsed, dict):
                    img_meta = parsed
        except Exception:
            img_meta = {}

        priority = compute_priority(lbl or 'other', conf, text=description or "", image_meta=img_meta)
    except Exception:
        priority = 0.0

    # Post-process analysis to add friendly messages and manual-review hints
    try:
        analysis = dict(result) if isinstance(result, dict) else {"label": str(result), "confidence": 0.0, "explanation": ''}
    except Exception:
        analysis = {"label": 'other', "confidence": 0.0, "explanation": ''}

    # try to parse explanation into image metadata when available
    img_meta = {}
    try:
        expl = analysis.get('explanation', '')
        if expl and isinstance(expl, str):
            parsed = json.loads(expl)
            if isinstance(parsed, dict):
                img_meta = parsed
    except Exception:
        img_meta = {}

    lbl = (analysis.get('label') or 'other')
    conf = float(analysis.get('confidence') or 0.0)

    # Friendly mappings (kept in sync with frontend)
    LABEL_TO_DAMAGE_DETAIL = {
        'pothole': 'Surface collapse / pothole',
        'street_light': 'Electrical / broken streetlight',
        'graffiti': 'Surface defacement / graffiti',
        'flooding': 'Water intrusion / flooding',
        'flood': 'Water intrusion / flooding',
        'trash': 'Illegal dumping / litter',
        'sidewalk_damage': 'Sidewalk crack / displacement',
        'other': 'General infrastructure issue'
    }

    # determine initial department label via router.route helper
    try:
        _, dept_label = route(lbl)
    except Exception:
        dept_label = 'Citizen Services'

    damage_type = LABEL_TO_DAMAGE_DETAIL.get(lbl, LABEL_TO_DAMAGE_DETAIL['other'])
    department_label = dept_label or 'Citizen Services'

    # Post-processing: detect invalid images, UI-like screenshots, or low-confidence
    requires_manual_review = False
    ai_note = ''
    is_ui_like = img_meta.get('is_ui_like') in (True, 'true', 'True')
    reason = img_meta.get('reason')
    low_confidence = conf < 0.45

    final_damage_type = damage_type
    final_department = department_label

    if reason == 'invalid_image':
        final_damage_type = 'Invalid image — please re-upload a valid photo'
        final_department = 'Citizen Services / Review'
        requires_manual_review = True
        ai_note = 'Invalid image detected'
    elif is_ui_like:
        final_damage_type = 'Unclear — uploaded image looks like a screenshot or UI; please upload a photo of the issue'
        final_department = 'Citizen Services / Review'
        requires_manual_review = True
        ai_note = 'Detected UI/screenshot; manual review recommended'
    elif low_confidence:
        final_damage_type = 'Uncertain — low confidence; please add a description or another photo'
        final_department = 'Citizen Services / Review'
        requires_manual_review = True
        ai_note = 'Low confidence classification'

    # Attach helpful fields to the analysis returned by the API
    analysis_out = dict(analysis)
    analysis_out['image_meta'] = img_meta
    analysis_out['final_damage_type'] = final_damage_type
    analysis_out['final_department'] = final_department
    analysis_out['requires_manual_review'] = bool(requires_manual_review)
    if ai_note:
        analysis_out['ai_note'] = ai_note

    # Safe server-side logging (append-only JSON lines) for audit and tuning.
    try:
        log_dir = ROOT_DIR / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)
        log_entry = {
            'ts': time.time(),
            'label': lbl,
            'confidence': conf,
            'image_meta': img_meta,
            'final_damage_type': final_damage_type,
            'final_department': final_department,
            'requires_manual_review': bool(requires_manual_review),
            'ai_note': ai_note,
            'priority': float(priority)
        }
        with open(log_dir / 'ai_analyze.log', 'a', encoding='utf-8') as lf:
            lf.write(json.dumps(log_entry, default=str) + "\n")
    except Exception:
        # logging must not break the API
        pass

    return JSONResponse(status_code=200, content={"status": "ok", "analysis": analysis_out, "priority": float(priority)})


@app.get("/ticket/{ticket_id}", response_model=TicketOut)
def get_ticket(ticket_id: str):
    t = db.get_ticket(ticket_id)
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


@app.get("/tickets")
def list_tickets(request: Request, state: Optional[str] = None, municipality: Optional[str] = None, department: Optional[str] = None):
    """Return tickets (DB-backed). Optional query params: state, municipality, department.
    If the request is from a municipal user (x-user-role: municipal) and the header
    `x-municipality` is present, the municipality filter will be forced to that value
    to avoid cross-municipality access in the prototype.
    """
    # If municipal request, scope to header municipality when provided
    role = request.headers.get('x-user-role') or request.headers.get('X-User-Role')
    header_muni = request.headers.get('x-municipality') or request.headers.get('X-Municipality')
    if role and header_muni and str(role).lower() == 'municipal':
        municipality = header_muni

    results = db.list_tickets(state=state, municipality=municipality, department=department)
    return results


@app.get('/municipalities')
def get_municipalities(state: Optional[str] = None):
    """Return known municipalities. For now we return the static mapping from departments module.
    Optionally accept a `state` query param in case of future multi-state support.
    """
    try:
        from .departments import list_municipalities
        return list_municipalities()
    except Exception:
        return {}



@app.get('/events')
async def events():
    """Server-Sent Events endpoint that streams new tickets to clients."""
    q = asyncio.Queue()
    SUBSCRIBERS.add(q)

    async def event_generator():
        try:
            # send a welcome comment so browsers don't immediately close
            yield ': connected\n\n'
            while True:
                data = await q.get()
                # serialize JSON safely
                payload = json.dumps(data, default=str)
                yield f"data: {payload}\n\n"
        finally:
            # cleanup on disconnect
            try:
                SUBSCRIBERS.discard(q)
            except Exception:
                pass

    return StreamingResponse(event_generator(), media_type='text/event-stream')


@app.get('/favicon.ico')
def favicon():
    """Return 204 No Content for favicon requests to avoid 404 noise in dev."""
    from fastapi.responses import Response
    return Response(status_code=204)


# SPA fallback: serve index.html for unknown frontend routes (so paths like /ticket/CIV-1005 load the SPA)
@app.get('/{full_path:path}')
def spa_fallback(full_path: str):
    idx = ROOT_DIR / 'index.html'
    if idx.exists():
        return FileResponse(str(idx))
    return JSONResponse({'status': 'ok'})
    """Return 204 No Content for favicon requests to avoid 404 noise in dev."""
    from fastapi.responses import Response
    return Response(status_code=204)


# SPA fallback: serve index.html for unknown frontend routes (so paths like /ticket/CIV-1005 load the SPA)
@app.get('/{full_path:path}')
def spa_fallback(full_path: str):
    idx = ROOT_DIR / 'index.html'
    if idx.exists():
        return FileResponse(str(idx))
    return JSONResponse({'status': 'ok'})
