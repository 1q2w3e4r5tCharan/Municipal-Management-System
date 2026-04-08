// Mock Data
const mockData = {
  issues: [
    {
      id: "CIV-1001",
      type: "Pothole",
      description: "Large pothole on main street causing traffic issues",
      location: "Main St & 5th Ave",
      lat: 40.7128,
      lng: -74.0060,
      priority: 87,
      status: "In Progress",
      department: "Public Works",
      submitted: "2 hours ago",
      reporter: "Sarah M.",
      upvotes: 12,
      confidence: 94
    },
    {
      id: "CIV-1002",
      type: "Broken Streetlight",
      description: "Streetlight out for 3 days",
      location: "Park Ave",
      lat: 40.7589,
      lng: -73.9851,
      priority: 62,
      status: "Under Review",
      department: "Traffic Management",
      submitted: "5 hours ago",
      reporter: "John D.",
      upvotes: 7,
      confidence: 91
    },
    {
      id: "CIV-1003",
      type: "Illegal Dumping",
      description: "Furniture dumped on sidewalk",
      location: "Oak Street",
      lat: 40.7489,
      lng: -73.9680,
      priority: 75,
      status: "Resolved",
      department: "Sanitation",
      submitted: "1 day ago",
      reporter: "Maria G.",
      upvotes: 15,
      confidence: 96,
      resolved_time: "4 hours ago"
    },
    {
      id: "CIV-1004",
      type: "Graffiti",
      description: "Graffiti on public building wall",
      location: "City Hall",
      lat: 40.7127,
      lng: -74.0134,
      priority: 45,
      status: "Submitted",
      department: "Code Enforcement",
      submitted: "30 minutes ago",
      reporter: "Anonymous",
      upvotes: 3,
      confidence: 89
    },
    {
      id: "CIV-1005",
      type: "Water Leak",
      description: "Water main leak flooding street",
      location: "Elm St",
      lat: 40.7580,
      lng: -73.9855,
      priority: 95,
      status: "In Progress",
      department: "Utilities",
      submitted: "1 hour ago",
      reporter: "David R.",
      upvotes: 24,
      confidence: 98
    }
  ],
  departments: [
    { name: "Public Works", workload: 12, avg_response: "4.2 hours" },
    { name: "Sanitation", workload: 8, avg_response: "3.8 hours" },
    { name: "Traffic Management", workload: 15, avg_response: "5.1 hours" },
    { name: "Parks & Recreation", workload: 6, avg_response: "6.5 hours" },
    { name: "Utilities", workload: 4, avg_response: "2.1 hours" },
    { name: "Code Enforcement", workload: 9, avg_response: "7.2 hours" }
  ],
  leaderboard: [
    { name: "Emma Wilson", score: 2840, reports: 67, rank: 1 },
    { name: "Michael Chen", score: 2315, reports: 52, rank: 2 },
    { name: "Sofia Rodriguez", score: 1998, reports: 48, rank: 3 },
    { name: "James Parker", score: 1876, reports: 44, rank: 4 },
    { name: "Alex Johnson", score: 1250, reports: 23, rank: 5 }
  ],
  categoryIcons: {
    "Pothole": "🕳️",
    "Broken Streetlight": "💡",
    "Illegal Dumping": "🗑️",
    "Graffiti": "🎨",
    "Water Leak": "💧",
    "Fallen Tree": "🌳",
    "Abandoned Vehicle": "🚗",
    "Traffic Signal": "🚦",
    "Infrastructure Damage": "🏗️"
  }
};

// Utility: format ticket id for display. Prefer backend `ticket_number`, otherwise
// generate a stable-looking fallback: CIV-<DEPT>-<last5-of-id>
function getDisplayTicketNumber(ticket) {
  if (!ticket) return '';
  if (ticket.ticket_number) return ticket.ticket_number;
  if (ticket.ticketNumber) return ticket.ticketNumber;
  const id = ticket.id || ticket.ticket_id || '';
  // derive dept code
  const deptLabel = (ticket.department_label || ticket.department || 'GEN').toString().toUpperCase();
  const deptCode = deptLabel.replace(/[^A-Z0-9]/gi, '').slice(0, 6) || 'GEN';
  // suffix: last 5 alnum chars from id
  const compact = id.replace(/[^a-zA-Z0-9]/g, '');
  const suffix = (compact.length >= 5) ? compact.slice(-5) : ('' + Math.floor((ticket.created_at||Date.now()) % 100000)).padStart(5, '0');
  return `CIV-${deptCode}-${suffix}`;
}

// Wrapper around fetch that injects a dev-only municipal header when in municipal mode.
// This makes it easy to test municipal-only endpoints from the UI without manual tooling.
async function apiFetch(url, opts = {}) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  // inject prototype role header when in municipal mode
  if (currentMode === 'municipal') {
    opts.headers['x-user-role'] = 'municipal';
  }
  return fetch(url, opts);
}

// State Management
let currentMode = 'citizen';
let currentView = 'citizenDashboard';
let uploadedPhoto = null;
let uploadedPhotoFile = null;
let isAuthenticated = false;
let currentUser = null;
let signupStep = 1;
let signupData = {};

// Utility Functions
function navigateTo(viewId) {
  // Hide all views
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

  // Show target view
  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
    currentView = viewId;
  }
}

// Map classifier labels to option values in the issue category select.
// This ensures the frontend auto-selects the correct option even when
// the classifier label uses underscores or different naming.
const LABEL_TO_OPTION = {
  'pothole': 'Pothole',
  'street_light': 'Broken Streetlight',
  'graffiti': 'Graffiti',
  'flooding': 'Water Leak',
  'trash': 'Illegal Dumping',
  'sidewalk_damage': 'Sidewalk Damage',
  'other': ''
};

function getPriorityClass(priority) {
  if (priority >= 80) return 'priority-high';
  if (priority >= 50) return 'priority-medium';
  return 'priority-low';
}

function getStatusClass(status) {
  if (!status) return 'status-unknown';
  const s = String(status).toLowerCase();
  if (s.includes('progress')) return 'status-inprogress';
  if (s.includes('resolved') || s.includes('complete')) return 'status-resolved';
  if (s.includes('review') || s.includes('submitted')) return 'status-submitted';
  return 'status-submitted';
}

// Simple toast helper used across the app
function showToast(message, emoji) {
  try {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.position = 'fixed';
      container.style.right = '16px';
      container.style.bottom = '16px';
      container.style.zIndex = '9999';
      document.body.appendChild(container);
    }

    const t = document.createElement('div');
    t.className = 'toast-item';
    t.style.background = 'rgba(0,0,0,0.8)';
    t.style.color = '#fff';
    t.style.padding = '8px 12px';
    t.style.marginTop = '8px';
    t.style.borderRadius = '6px';
    t.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    t.style.fontFamily = 'sans-serif';
    t.style.display = 'flex';
    t.style.alignItems = 'center';
    t.style.gap = '8px';

    if (emoji) {
      const e = document.createElement('span');
      e.textContent = emoji;
      t.appendChild(e);
    }
    const msg = document.createElement('span');
    msg.textContent = message;
    t.appendChild(msg);

    container.appendChild(t);

    setTimeout(() => {
      t.style.transition = 'opacity 0.3s ease';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 3000);
  } catch (e) {
    // silent
    console.warn('showToast error', e);
  }
}

// Utility to escape strings for embedding in single-quoted HTML attributes
function escAttr(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

// Initialize the community activity feed by loading recent tickets
function initActivityFeed() {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;
  // We'll build DOM nodes (not raw innerHTML) so we can safely render richer content
  function renderList(items) {
    // clear
    feed.innerHTML = '';
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '12px';

    for (let t of items.slice(0, 6)) {
      const id = t.id || t.ticket_id || '';
      const ticketNo = getDisplayTicketNumber(t);
      const title = (t.label || t.type || 'Report');
      const dept = t.department_label || t.department || '';
      const muni = t.municipality || '';
      const ts = t.created_at ? new Date(t.created_at * 1000) : (t.createdAt ? new Date(t.createdAt) : new Date());
      const timeStr = ts.toLocaleDateString('en-GB') + ', ' + ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

      const card = document.createElement('div');
      card.className = 'activity-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.style.display = 'flex';
      card.style.alignItems = 'flex-start';
      card.style.gap = '12px';
      card.style.padding = '12px';
      card.style.borderRadius = '12px';
      card.style.background = 'var(--color-surface)';
      card.style.border = '1px solid var(--color-card-border)';
      card.style.boxShadow = 'var(--shadow-sm)';

      // emoji / icon
      const emoji = document.createElement('div');
      emoji.className = 'activity-emoji';
      emoji.textContent = mockData.categoryIcons[t.type] || '🤖';
      emoji.style.width = '44px';
      emoji.style.height = '44px';
      emoji.style.display = 'flex';
      emoji.style.alignItems = 'center';
      emoji.style.justifyContent = 'center';
      emoji.style.fontSize = '20px';
      emoji.style.borderRadius = '10px';
      emoji.style.background = 'rgba(var(--color-teal-500-rgb), 0.06)';

      // optional thumbnail if the ticket contains a photo
      const thumbUrl = t.photo_url || t.photo || (t.metadata && (t.metadata.photo_url || t.metadata.photo));
      let thumbEl = null;
      if (thumbUrl) {
        thumbEl = document.createElement('img');
        thumbEl.className = 'activity-thumb';
        thumbEl.src = thumbUrl;
        thumbEl.alt = title + ' thumbnail';
        thumbEl.loading = 'lazy';
        thumbEl.style.objectFit = 'cover';
        thumbEl.style.borderRadius = '8px';
        thumbEl.style.flex = '0 0 72px';
        // if the image fails, hide it to keep layout neat
        thumbEl.onerror = function() { this.style.display = 'none'; };
        // clicking the thumbnail opens the modal like the card
        thumbEl.addEventListener('click', (e) => { e.stopPropagation(); showIssueModal(id); });
      }

      // body
      const body = document.createElement('div');
      body.style.flex = '1';
      body.style.minWidth = '0';

      const h = document.createElement('div');
      h.style.display = 'flex';
      h.style.justifyContent = 'space-between';
      h.style.alignItems = 'baseline';

      const titleEl = document.createElement('div');
      titleEl.className = 'activity-title';
      titleEl.textContent = title;
      titleEl.style.fontWeight = '600';
      titleEl.style.fontSize = '14px';
      titleEl.style.marginBottom = '6px';
      titleEl.style.overflow = 'hidden';
      titleEl.style.textOverflow = 'ellipsis';
      titleEl.style.whiteSpace = 'nowrap';

      const metaRight = document.createElement('div');
      metaRight.style.fontSize = '12px';
      metaRight.style.color = 'var(--color-text-secondary)';
      metaRight.textContent = timeStr;

      h.appendChild(titleEl);
      h.appendChild(metaRight);

      const meta = document.createElement('div');
      meta.className = 'activity-meta';
      meta.style.fontSize = '13px';
      meta.style.color = 'var(--color-text-secondary)';
      meta.style.display = 'flex';
      meta.style.flexWrap = 'wrap';
      meta.style.gap = '8px';

      const deptEl = document.createElement('span');
      deptEl.textContent = dept || '';
      deptEl.style.maxWidth = '50%';
      deptEl.style.overflow = 'hidden';
      deptEl.style.textOverflow = 'ellipsis';

      const ticketLink = document.createElement('a');
      ticketLink.href = '#';
      ticketLink.textContent = ticketNo;
      ticketLink.style.color = 'var(--color-primary)';
      ticketLink.style.fontWeight = '500';
      ticketLink.onclick = function(ev) { ev.preventDefault(); ev.stopPropagation(); showIssueModal(id); };

      const muniEl = document.createElement('span');
      muniEl.textContent = muni;
      muniEl.style.background = 'rgba(var(--color-slate-500-rgb),0.06)';
      muniEl.style.padding = '2px 8px';
      muniEl.style.borderRadius = '999px';
      muniEl.style.fontSize = '12px';
      muniEl.style.color = 'var(--color-text-secondary)';

      meta.appendChild(deptEl);
      meta.appendChild(ticketLink);
      if (muni) meta.appendChild(muniEl);

      body.appendChild(h);
      body.appendChild(meta);

  card.appendChild(emoji);
  if (thumbEl) card.appendChild(thumbEl);
  card.appendChild(body);

      // accessibility + click
      card.addEventListener('click', () => showIssueModal(id));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showIssueModal(id); } });

      container.appendChild(card);
    }

    feed.appendChild(container);
  }

  // Try backend first
  fetch('/tickets').then(r => r.ok ? r.json() : Promise.reject()).then(data => {
    data.sort((a,b)=> (b.created_at||0)-(a.created_at||0));
    // dedupe by id while preserving order
    const seen = new Set();
    const unique = [];
    for (const t of data) {
      const tid = t.id || t.ticket_id || t.ticket_number || JSON.stringify(t);
      if (seen.has(tid)) continue;
      seen.add(tid);
      unique.push(t);
      if (unique.length >= 6) break;
    }
    renderList(unique);
  }).catch(()=>{
    // fallback to mock data
    renderList(mockData.issues.map(issue => ({
      id: issue.id,
      label: issue.type,
      type: issue.type,
      department_label: issue.department,
      created_at: Date.now() / 1000,
      municipality: '',
    })));
  });
}

// Initialize Server-Sent Events connection for live updates
function initSSE() {
  if (!('EventSource' in window)) return;
  const es = new EventSource('/events');
  es.onopen = function() {
    console.log('SSE connected');
  };
  es.onmessage = function(e) {
    try {
      const payload = JSON.parse(e.data);
      // Simple reaction: refresh lists and feed
      showToast('New report received', '🆕');
      loadTicketsToReportsList();
      initActivityFeed();
    } catch (err) {
      console.warn('SSE message parse error', err);
    }
  };
  es.onerror = function(err) {
    console.warn('SSE error', err);
    // try reconnect after a short delay
    es.close();
    setTimeout(initSSE, 3000);
  };
}

function initReportsList() {
  const list = document.getElementById('reportsList');
  if (!list) return;

  function renderTickets(tickets) {
    if (!tickets || tickets.length === 0) {
      list.innerHTML = '<div class="section-card">No reports yet.</div>';
      return;
    }

    list.innerHTML = tickets.map(ticket => {
      const id = ticket.id || ticket.ticket_id || '';
  // prefer human-friendly ticket_number when available
  const displayId = getDisplayTicketNumber(ticket);
      const label = ticket.label || ticket.type || 'Unknown';
      const department = ticket.department_label || ticket.department || '';
  const submitted = ticket.created_at ? new Date(ticket.created_at * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ticket.submitted || '';
      const status = ticket.status || 'Submitted';
      return `
        <div class="report-card" onclick="showIssueModal('${id}')">
          <div class="report-header">
            <div>
              <div class="report-id">${displayId}</div>
              <div class="report-type">${label}</div>
              <div class="report-location">📍 ${ticket.location || ''}</div>
            </div>
            <span class="status-badge ${getStatusClass(status)}">${status}</span>
          </div>
    <div class="report-timeline">
            <div class="timeline-step completed">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-title">Submitted</div>
                <div class="timeline-time">${submitted}</div>
              </div>
            </div>
            <div class="timeline-step completed">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-title">AI Classified</div>
                <div class="timeline-time">Confidence: ${Math.round((ticket.confidence || 0) * 100)}%</div>
              </div>
            </div>
            <div class="timeline-step ${status !== 'Submitted' ? 'completed' : ''}">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-title">Routed to ${department}</div>
                <div class="timeline-time">${status !== 'Submitted' ? 'Assigned' : 'Pending'}</div>
              </div>
            </div>
            <div class="timeline-step ${status === 'In Progress' || status === 'Resolved' ? 'active' : ''}">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-title">In Progress</div>
                <div class="timeline-time">${status === 'In Progress' || status === 'Resolved' ? 'Current' : 'Pending'}</div>
              </div>
            </div>
            <div class="timeline-step ${status === 'Resolved' ? 'completed' : ''}">
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <div class="timeline-title">Resolved</div>
                <div class="timeline-time">${ticket.resolved_time || 'Pending'}</div>
              </div>
            </div>
          </div>
          <div class="report-actions" style="margin-top:16px; display:flex; gap:12px;">
            <button class="btn btn-sm" onclick="event.stopPropagation(); showIssueModal('${id}')">View details</button>
            <button class="btn btn-outline btn-sm contact-muni" data-dept="${(department||'').replace(/\"/g,'&quot;')}" data-ticket="${id}" onclick="event.stopPropagation(); contactMunicipality(this.getAttribute('data-dept'), this.getAttribute('data-ticket'))">Contact municipality</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Try backend first, fallback to mock
  fetch('/tickets').then(r => r.ok ? r.json() : Promise.reject()).then(data => {
    data.sort((a,b)=> (b.created_at||0)-(a.created_at||0));
    renderTickets(data);
  }).catch(() => {
    const userReports = mockData.issues.slice(0, 3);
    renderTickets(userReports.map(issue => ({
      id: issue.id,
      label: issue.type,
      department_label: issue.department,
      priority: issue.priority / 100,
      created_at: Date.now() / 1000,
      confidence: issue.confidence / 100,
      location: issue.location,
      status: issue.status,
      resolved_time: issue.resolved_time
    })));
  });
}

// Helper to explicitly reload tickets (used after submitting)
function loadTicketsToReportsList() {
  const list = document.getElementById('reportsList');
  if (!list) return;
  fetch('/tickets').then(r => r.ok ? r.json() : Promise.reject()).then(data => {
    data.sort((a,b)=> (b.created_at||0)-(a.created_at||0));
    const renderable = data.map(t=>({
      id: t.id,
      ticket_number: t.ticket_number,
      label: t.label,
      department_label: t.department_label,
      priority: t.priority,
      created_at: t.created_at,
      confidence: t.confidence,
      location: t.metadata && t.metadata.location
    }));
    const originalMock = mockData.issues;
    mockData.issues = renderable;
    initReportsList();
    mockData.issues = originalMock;
  }).catch(()=> initReportsList());
}

// Initialize Leaderboard
function initLeaderboard() {
  const leaderboard = document.getElementById('leaderboard');
  if (!leaderboard) return;
  
  leaderboard.innerHTML = mockData.leaderboard.map((user, index) => `
    <div class="leaderboard-item ${user.name === 'Alex Johnson' ? 'current-user' : ''}">
      <div class="leaderboard-rank ${index < 3 ? 'top' : ''}">${index + 1}</div>
      <div class="leaderboard-info">
        <div class="leaderboard-name">${user.name}</div>
        <div class="leaderboard-reports">${user.reports} reports</div>
      </div>
      <div class="leaderboard-score">${user.score.toLocaleString()}</div>
    </div>
  `).join('');
}

// Photo Upload Handler
function initPhotoUpload() {
  const input = document.getElementById('photoInput');
  const preview = document.getElementById('photoPreview');
  const placeholder = document.getElementById('uploadPlaceholder');
  const aiClassification = document.getElementById('aiClassification');
  const priorityIndicator = document.getElementById('priorityIndicator');
  const submitBtn = document.getElementById('submitReportBtn');
  const categorySelect = document.getElementById('issueCategory');
  
  if (!input) return;
  
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        // keep a data URL for preview and the File for upload
        uploadedPhoto = e.target.result;
        uploadedPhotoFile = file;
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        placeholder.style.display = 'none';
        // show a "Replace photo" button next to the upload placeholder
        let replaceBtn = document.getElementById('replacePhotoBtn');
        if (!replaceBtn) {
          replaceBtn = document.createElement('button');
          replaceBtn.id = 'replacePhotoBtn';
          replaceBtn.className = 'btn btn-outline btn-sm';
          replaceBtn.textContent = 'Replace photo';
          replaceBtn.style.marginLeft = '8px';
          replaceBtn.onclick = (ev) => { ev.preventDefault(); input.click(); };
          // insert after placeholder so it shows near the upload area
          if (placeholder && placeholder.parentNode) placeholder.parentNode.insertBefore(replaceBtn, placeholder.nextSibling);
        } else {
          replaceBtn.style.display = 'inline-block';
        }
        
        // Call backend AI analyze endpoint (supports Gemini or local fallback)
        (async () => {
          try {
            aiClassification.innerHTML = `<div class="ai-header"><div class="ai-icon">🤖</div><div class="ai-title">Analyzing image…</div></div>`;
            aiClassification.classList.add('show');

            const form = new FormData();
            form.append('image', file, file.name || 'photo.jpg');

            // Use apiFetch wrapper (it will add municipal header in municipal mode)
            const resp = await apiFetch('/ai/analyze', { method: 'POST', body: form });
            if (!resp.ok) {
              const txt = await resp.text();
              throw new Error('Analysis failed: ' + txt);
            }
            const data = await resp.json();
            const analysis = data.analysis || {};

            // Map label (e.g., 'pothole' -> 'Pothole') to UI category option
            const label = (analysis.label || '').toString().toLowerCase();
            const pretty = label.replace(/_/g, ' ').split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

            // build result UI (professional, human-friendly)
            const icon = mockData.categoryIcons[pretty] || '🤖';
            const confidencePct = Math.round((analysis.confidence || 0) * 100);

            // Try to parse explanation if it's a JSON string so we can present metrics
            let metrics = {};
            try {
              if (analysis.explanation) {
                if (typeof analysis.explanation === 'string') {
                  metrics = JSON.parse(analysis.explanation);
                } else if (typeof analysis.explanation === 'object') {
                  metrics = analysis.explanation;
                }
              }
            } catch (e) {
              // leave metrics empty and fall back to raw explanation
              metrics = { _raw: analysis.explanation };
            }

            // helper to format numbers safely
            const fmt = (v, digits=1) => (v === undefined || v === null) ? '—' : (Number(v).toFixed(digits));

            const edgeStr = (metrics.edge_density !== undefined) ? (Number(metrics.edge_density) * 100).toFixed(1) + '%' : (metrics.edge_density === 0 ? '0%' : '—');
            const isUi = metrics.is_ui_like === true || metrics.is_ui_like === 'true';

            // derive friendly issue parameters
            const LABEL_TO_DAMAGE_DETAIL = {
              'pothole': 'Surface collapse / pothole',
              'street_light': 'Electrical / broken streetlight',
              'fallen_tree': 'Fallen tree / blocked roadway',
              'graffiti': 'Surface defacement / graffiti',
              'flooding': 'Water intrusion / flooding',
              'flood': 'Water intrusion / flooding',
              'trash': 'Illegal dumping / litter',
              'sidewalk_damage': 'Sidewalk crack / displacement',
              'other': 'General infrastructure issue'
            };

            const LABEL_TO_DEPARTMENT = {
              'pothole': 'Public Works',
              'street_light': 'Traffic Management',
              'fallen_tree': 'Parks & Tree Management',
              'graffiti': 'Code Enforcement',
              'flooding': 'Utilities',
              'flood': 'Utilities',
              'trash': 'Sanitation',
              'sidewalk_damage': 'Public Works',
              // treat 'other' as a neutral / citizen services bucket by default
              'other': 'Citizen Services'
            };

            const issueCategory = pretty || 'Unknown';
            const damageType = LABEL_TO_DAMAGE_DETAIL[label] || LABEL_TO_DAMAGE_DETAIL['other'];
            const department = LABEL_TO_DEPARTMENT[label] || 'Citizen Services';
            const severity = (confidencePct >= 80) ? 'Critical' : (confidencePct >= 60) ? 'High' : (confidencePct >= 40) ? 'Medium' : 'Low';

            // Post-processing: if the model thinks this is a UI-like screenshot or confidence is low,
            // avoid auto-assigning to Public Works and route to Citizen Services for manual review.
            const lowConfidence = (analysis.confidence || 0) < 0.45;
            let finalDamageType = damageType;
            let finalDepartment = department;
            let aiNote = '';

            if (metrics && metrics.reason === 'invalid_image') {
              finalDamageType = 'Invalid image — please re-upload a valid photo';
              finalDepartment = 'Citizen Services';
              aiNote = 'Invalid image detected';
            } else if (isUi) {
              // screenshots or UI mockups should not be auto-classified as infrastructure damage
              finalDamageType = 'Unclear — uploaded image looks like a screenshot or UI; please upload a photo of the issue';
              finalDepartment = 'Citizen Services';
              aiNote = 'Detected UI/screenshot; manual review recommended';
            } else if (lowConfidence) {
              finalDamageType = 'Uncertain — low confidence; please add a description or another photo';
              finalDepartment = 'Citizen Services';
              aiNote = 'Low confidence classification';
            }

            aiClassification.innerHTML = `
              <div class="ai-header">
                <div class="ai-icon">🤖</div>
                <div class="ai-title">Issue parameters — AI analysis</div>
              </div>
              <div class="ai-result">${icon} ${pretty}</div>

              <div class="ai-params" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">
                <div style="flex:1 1 160px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Category</div>
                  <div style="font-weight:700;font-size:14px;">${issueCategory}</div>
                </div>
                <div style="flex:1 1 200px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Type of Damage</div>
                  <div style="font-weight:700;font-size:14px;">${finalDamageType}</div>
                </div>
                <div style="flex:1 1 160px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Department</div>
                  <div style="font-weight:700;font-size:14px;">${finalDepartment}</div>
                </div>
                <div style="flex:1 1 120px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Severity</div>
                  <div style="font-weight:700;font-size:14px;">${severity}</div>
                </div>
              </div>

              ${aiNote ? `<div style="margin-top:8px;color:var(--color-accent);font-weight:600;">Note: ${aiNote}</div>` : ''}

              <div class="ai-confidence" style="display:flex;align-items:center;gap:12px;">
                <div style="flex:1;background:rgba(255,255,255,0.12);height:12px;border-radius:8px;overflow:hidden;">
                  <div style="height:100%;background:linear-gradient(90deg,var(--color-primary),#8b5cf6);width:${confidencePct}%;"></div>
                </div>
                <div style="min-width:56px;font-weight:600;">${confidencePct}%</div>
              </div>

              <div class="ai-metrics" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;">
                <div style="flex:1 1 140px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Image</div>
                  <div style="font-weight:700;font-size:14px;">${metrics.width || '—'} × ${metrics.height || '—'}</div>
                </div>
                <div style="flex:1 1 140px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Avg Brightness</div>
                  <div style="font-weight:700;font-size:14px;">${fmt(metrics.avg_brightness,1)}</div>
                </div>
                <div style="flex:1 1 140px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Saturation (S)</div>
                  <div style="font-weight:700;font-size:14px;">${metrics.s_mean !== undefined ? fmt(metrics.s_mean,1) : '—'}</div>
                </div>
                <div style="flex:1 1 140px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Edge Density</div>
                  <div style="font-weight:700;font-size:14px;">${edgeStr}</div>
                </div>
                <div style="flex:1 1 140px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">Center Brightness</div>
                  <div style="font-weight:700;font-size:14px;">${metrics.center_avg !== undefined ? fmt(metrics.center_avg,1) : '—'}</div>
                </div>
                <div style="flex:1 1 140px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;">
                  <div style="font-size:12px;color:rgba(255,255,255,0.8);">UI-like Screenshot</div>
                  <div style="font-weight:700;font-size:14px;">${isUi ? 'Yes' : 'No'}</div>
                </div>
              </div>

              <div style="margin-top:12px;opacity:0.9;font-size:13px;">Source: <strong>${analysis.source || 'local'}</strong></div>

              ${metrics._raw ? `<pre style="margin-top:12px;background:rgba(255,255,255,0.04);padding:10px;border-radius:8px;overflow:auto;color:#fff;font-size:12px;">${escAttr(String(metrics._raw))}</pre>` : ''}
            `;

            // Auto-select category using LABEL_TO_OPTION mapping. Fall back to
            // trying the prettified label if no mapping exists.
            let mappedValue = LABEL_TO_OPTION[label] || pretty;
            let matched = false;
            if (mappedValue) {
              for (let i = 0; i < categorySelect.options.length; i++) {
                const opt = categorySelect.options[i];
                if (opt.value.toLowerCase() === mappedValue.toString().toLowerCase()) {
                  categorySelect.value = opt.value;
                  matched = true;
                  break;
                }
              }
            }

            // Show a simple priority indicator derived from confidence
            const priority = Math.min(99, 40 + Math.round((analysis.confidence || 0) * 100 * 0.6));
            priorityIndicator.innerHTML = `
              <div class="priority-header">
                <div class="priority-label">Priority Score</div>
                <div class="priority-score">${priority}</div>
              </div>
              <div class="priority-bar">
                <div class="priority-fill" style="width: ${priority}%"></div>
              </div>
            `;
            priorityIndicator.classList.add('show');

            // Enable submit button if category selected or matched
            if (matched || categorySelect.value) {
              submitBtn.disabled = false;
            }

            showToast('AI analysis complete', '🤖');
          } catch (err) {
            console.error('AI analyze error', err);
            aiClassification.innerHTML = `<div class="ai-header"><div class="ai-icon">⚠️</div><div class="ai-title">Analysis failed</div></div><div class="ai-explain">${err.message || ''}</div>`;
            aiClassification.classList.add('show');
            // keep submit disabled to force manual category selection
            submitBtn.disabled = false;
          }
        })();
      };
      reader.readAsDataURL(file);
    }
  });
}

// Submit Report Handler
function initSubmitReport() {
  const submitBtn = document.getElementById('submitReportBtn');
  if (!submitBtn) return;
  
  submitBtn.addEventListener('click', async () => {
    const categorySelect = document.getElementById('issueCategory');
    const description = document.getElementById('issueDescription');

    if (!uploadedPhotoFile || !categorySelect.value) {
      showToast('Please upload a photo and select a category', '⚠️');
      return;
    }

    // Show loading state
    submitBtn.innerHTML = '<span>Submitting...</span>';
    submitBtn.disabled = true;

    try {
      const form = new FormData();
      form.append('description', description.value || '');
      form.append('image', uploadedPhotoFile, uploadedPhotoFile.name || 'photo.jpg');
  form.append('category', categorySelect.value || '');
  // include municipality (client-side) so backend can scope ticket numbers
  const muniSelect = document.getElementById('municipalitySelect');
  if (muniSelect) form.append('municipality', muniSelect.value || 'GEN');
  // append privacy/contact fields
  const phoneEl = document.getElementById('reporterPhone');
  const wardEl = document.getElementById('reporterWard');
  const consentEl = document.getElementById('consentCheckbox');
  if (phoneEl) form.append('phone', phoneEl.value || '');
  if (wardEl) form.append('ward', wardEl.value || '');
  if (consentEl) form.append('consent', consentEl.checked ? '1' : '0');

      const resp = await fetch('/report', { method: 'POST', body: form });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error('Server error: ' + txt);
      }
      const data = await resp.json();

      // Reset form/UI
      document.getElementById('photoPreview').classList.add('hidden');
      document.getElementById('uploadPlaceholder').style.display = 'flex';
      document.getElementById('aiClassification').classList.remove('show');
      document.getElementById('priorityIndicator').classList.remove('show');
      categorySelect.value = '';
      description.value = '';
      uploadedPhoto = null;
      uploadedPhotoFile = null;

      submitBtn.innerHTML = '<span>Submit Report</span><span class="points-badge">+50 Points</span>';
      submitBtn.disabled = true;

      // Show confirmation modal
      document.getElementById('confirmationModal').classList.remove('hidden');

      // Reload tickets list (if visible)
      try { 
        loadTicketsToReportsList(); 
        initActivityFeed();
        // navigate to tracking view so user can see the submitted ticket
        navigateTo('trackReport');
      } catch (e) { /* ignore */ }
    } catch (err) {
      console.error(err);
      showToast('Failed to submit report: ' + (err.message || ''), '❌');
      submitBtn.innerHTML = '<span>Submit Report</span><span class="points-badge">+50 Points</span>';
      submitBtn.disabled = false;
    }
  });
}

function closeConfirmation() {
  document.getElementById('confirmationModal').classList.add('hidden');
  navigateTo('trackReport');
}

// Modal Functions
function showIssueModal(issueId) {
  const modal = document.getElementById('issueModal');
  const modalBody = document.getElementById('modalBody');

  // Try to fetch a ticket from backend first (DB-backed). Fallback to mockData.
  fetch(`/ticket/${issueId}`).then(r => r.ok ? r.json() : Promise.reject()).then(issue => {
    renderIssueModal(issue, modalBody);
  }).catch(() => {
    const issue = mockData.issues.find(i => i.id === issueId);
    if (!issue) return;
    renderIssueModal(issue, modalBody);
  });
}

function renderIssueModal(issue, modalBody) {
  if (!issue) return;
  // ensure modal element is available here (fixes "modal is not defined")
  const modal = document.getElementById('issueModal');
  // normalize confidence to percentage number
  let conf = Number(issue.confidence || 0);
  if (conf <= 1) conf = Math.round(conf * 100);
  else conf = Math.round(conf);

  modalBody.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-bottom: 24px;">
      <div>
  <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Issue ID</div>
  <div style="font-weight: 700;">${getDisplayTicketNumber(issue)}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Status</div>
        <span class="status-badge ${getStatusClass(issue.status)}">${issue.status}</span>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Category</div>
        <div style="font-weight: 700;">${mockData.categoryIcons[issue.type || issue.label] || ''} ${issue.type || issue.label}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Priority</div>
        <span class="priority-score-badge ${getPriorityClass(issue.priority)}">${issue.priority}</span>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Location</div>
        <div style="font-weight: 600;">📍 ${issue.location}</div>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 4px;">Department</div>
        <div style="font-weight: 600;">${issue.department_label || issue.department || ''}</div>
      </div>
    </div>
    
    <div style="margin-bottom: 24px;">
      <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px;">AI Classification</div>
        <div style="background: var(--color-background); padding: 16px; border-radius: 12px;">
        <div style="font-weight: 700; margin-bottom: 4px;">${issue.type || issue.label}</div>
        <div style="font-size: 14px; color: var(--color-text-secondary);">Confidence: ${conf}%</div>
      </div>
    </div>
    
    <div style="margin-bottom: 24px;">
      <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px;">Description</div>
      <div style="color: var(--color-text);">${issue.description}</div>
    </div>
    
    <div style="margin-bottom: 24px;">
      <div style="font-size: 12px; color: var(--color-text-secondary); margin-bottom: 8px;">Submitted By</div>
  <div style="font-weight: 600;">${issue.reporter || ''} • ${issue.submitted || (issue.created_at ? new Date(issue.created_at*1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '')}</div>
      <div style="font-size: 14px; color: var(--color-text-secondary); margin-top: 4px;">👍 ${issue.upvotes || 0} citizens supporting this issue</div>
    </div>
    
    ${currentMode === 'municipal' ? `
      <div style="border-top: 1px solid var(--color-border); padding-top: 24px;">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">Actions</h3>
        <div style="display: flex; gap: 12px;">
          <button class="btn btn-primary" onclick="updateIssueStatus('${issue.id}', 'In Progress')">Accept Issue</button>
          <button class="btn btn-sm" onclick="openAssignModal('${issue.id}')">Assign Ticket</button>
          <button class="btn btn-sm" onclick="openScheduleModal('${issue.id}')">Schedule Work</button>
          <button class="btn btn-sm" onclick="closeModal()">Add Notes</button>
        </div>
      </div>
    ` : ''}
  `;
  
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('issueModal').classList.add('hidden');
}

// Open a mailto: link to contact the municipal department. If a department label is
// provided, synthesize an email like dept.name@city.gov; otherwise use a generic contact.
function contactMunicipality(departmentLabel, ticketId) {
  // Fetch the ticket from backend to get authoritative department email, then open contact modal
  fetch(`/ticket/${ticketId}`).then(r => r.ok ? r.json() : Promise.reject()).then(ticket => {
    const deptEmail = ticket.department_email || '';
    openContactModal(ticketId, ticket.department_label || departmentLabel || '', deptEmail);
  }).catch(() => {
    // fallback: open modal with what we have
    openContactModal(ticketId, departmentLabel || '', '');
  });
}

function openContactModal(ticketId, departmentLabel, departmentEmail) {
  document.getElementById('contactTicketId').value = ticketId || '';
  document.getElementById('contactDepartment').value = departmentLabel || '';
  document.getElementById('contactDeptEmail').value = departmentEmail || '';
  document.getElementById('contactName').value = currentUser && currentUser.name ? currentUser.name : '';
  document.getElementById('contactEmail').value = currentUser && currentUser.email ? currentUser.email : '';
  document.getElementById('contactMessage').value = `Regarding ticket ${ticketId}: `;
  document.getElementById('contactModal').classList.remove('hidden');
}

function closeContactModal() {
  document.getElementById('contactModal').classList.add('hidden');
}

function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      ticket_id: document.getElementById('contactTicketId').value,
      department: document.getElementById('contactDepartment').value,
      sender_name: document.getElementById('contactName').value,
      sender_email: document.getElementById('contactEmail').value,
      message: document.getElementById('contactMessage').value,
    };
    try {
      const resp = await fetch('/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error('Network error');
      const data = await resp.json();
      showToast('Message sent to municipality', '✉️');
      closeContactModal();
    } catch (err) {
      console.error('Contact submit failed', err);
      showToast('Failed to send message', '❌');
    }
  });
}

// Assign & Schedule Modals — frontend wiring to backend endpoints
function openAssignModal(ticketId, staffName, staffEmail) {
  const modal = document.getElementById('assignModal');
  if (!modal) return;
  document.getElementById('assignTicketId').value = ticketId || '';
  document.getElementById('assignStaffName').value = staffName || '';
  document.getElementById('assignStaffEmail').value = staffEmail || '';
  document.getElementById('assignNote').value = '';
  modal.classList.remove('hidden');
}

function closeAssignModal() {
  const modal = document.getElementById('assignModal');
  if (modal) modal.classList.add('hidden');
}

function initAssignForm() {
  const form = document.getElementById('assignForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      ticket_id: document.getElementById('assignTicketId').value,
      staff_name: document.getElementById('assignStaffName').value,
      staff_email: document.getElementById('assignStaffEmail').value,
      assigned_by: (currentUser && currentUser.email) ? currentUser.email : undefined,
      note: document.getElementById('assignNote').value
    };
    try {
      const resp = await apiFetch('/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error('Assign failed');
      const data = await resp.json();
      showToast('Ticket assigned', '✅');
      closeAssignModal();
      loadTicketsToReportsList();
    } catch (err) {
      console.error('Assign failed', err);
      showToast('Assignment failed', '❌');
    }
  });
}

// Ticket picker modal
function openTicketPickerModal() {
  const modal = document.getElementById('ticketPickerModal');
  if (!modal) return;
  document.getElementById('ticketPickerSearch').value = '';
  document.getElementById('ticketPickerList').innerHTML = '<div class="section-card">Loading...</div>';
  modal.classList.remove('hidden');
  // load tickets
  apiFetch('/tickets').then(r=>r.ok?r.json():Promise.reject()).then(data=>{
    window.__ticketPickerData = data || [];
    renderTicketPickerList(data);
  }).catch(()=>{
    // fallback to mock
    window.__ticketPickerData = mockData.issues || [];
    renderTicketPickerList(window.__ticketPickerData);
  });
}

function closeTicketPickerModal() { const m = document.getElementById('ticketPickerModal'); if (m) m.classList.add('hidden'); }

function renderTicketPickerList(data) {
  const list = document.getElementById('ticketPickerList');
  const q = document.getElementById('ticketPickerSearch').value.trim().toLowerCase();
  const filtered = (data||[]).filter(t=>{
    if (!q) return true;
    return (t.id||'').toLowerCase().includes(q) || (t.ticket_number||'').toLowerCase().includes(q) || (t.label||'').toLowerCase().includes(q) || (t.department_label||'').toLowerCase().includes(q) || (t.metadata && (t.metadata.location||'')).toLowerCase().includes(q);
  });
  if (!filtered.length) { list.innerHTML = '<div class="section-card">No tickets found.</div>'; return; }
  list.innerHTML = filtered.map(t=>{
    const display = getDisplayTicketNumber(t);
    const label = t.label || t.type || 'Report';
    const meta = t.department_label || t.department || '';
    return `<div class="ticket-picker-item" onclick="selectTicketFromPicker('${t.id||t.ticket_id||''}')"><div style="font-weight:700">${display}</div><div style="font-size:13px;color:var(--color-text-secondary)">${label} • ${meta}</div></div>`;
  }).join('');
}

function selectTicketFromPicker(ticketId) {
  document.getElementById('assignTicketId').value = ticketId;
  closeTicketPickerModal();
  showToast('Ticket selected', '✅');
}

// wire search input
document.addEventListener('input', function(e){
  if (e.target && e.target.id === 'ticketPickerSearch') {
    if (window.__ticketPickerData) renderTicketPickerList(window.__ticketPickerData);
  }
  if (e.target && e.target.id === 'assignStaffSearch') {
    const q = e.target.value.trim().toLowerCase();
    const container = document.getElementById('assignStaffList');
    if (!container) return;
    // debounce backend calls
    if (window.__staffSearchTimeout) clearTimeout(window.__staffSearchTimeout);
    window.__staffSearchTimeout = setTimeout(async () => {
      try {
        const resp = await apiFetch('/staff');
        const staff = resp.ok ? await resp.json() : (enhancedMunicipalData && enhancedMunicipalData.staffDirectory) ? enhancedMunicipalData.staffDirectory : [];
        const filtered = (staff || []).filter(s => (s.name||'').toLowerCase().includes(q));
        container.innerHTML = filtered.map(s=>`<div class="assign-staff-item" onclick="selectStaff('${(s.name||'').replace(/'/g,'\\\'')}','${s.email||''}')"><div style="font-weight:600">${s.name}</div><div style="font-size:12px;color:var(--color-text-secondary)">${s.role || ''} • ${s.department || ''}</div></div>`).join('');
      } catch (err) {
        // fallback to local data
        const staff = (enhancedMunicipalData && enhancedMunicipalData.staffDirectory) ? enhancedMunicipalData.staffDirectory : mockData.issues;
        const filtered = staff.filter(s => (s.name||'').toLowerCase().includes(q));
        container.innerHTML = filtered.map(s=>`<div class="assign-staff-item" onclick="selectStaff('${(s.name||'').replace(/'/g,'\\\'')}','${s.email||''}')"><div style="font-weight:600">${s.name}</div><div style="font-size:12px;color:var(--color-text-secondary)">${s.role || ''} • ${s.department || ''}</div></div>`).join('');
      }
    }, 220);
  }
});

// Manage Team modal functions
function openManageTeamModal() {
  const m = document.getElementById('manageTeamModal');
  const btn = document.getElementById('manageTeamBtn');
  if (m) m.classList.remove('hidden');
  if (btn) btn.classList.add('hidden');
  loadStaffList();
}

function closeManageTeamModal() {
  const m = document.getElementById('manageTeamModal');
  const btn = document.getElementById('manageTeamBtn');
  if (m) m.classList.add('hidden');
  if (btn) btn.classList.remove('hidden');
}

function renderStaffList(el, staff) {
  if (!el) return;
  if (!staff || staff.length === 0) { el.innerHTML = '<div class="section-card">No staff found.</div>'; return; }
  // Render cards using the same structure as the static examples in index.html
  el.innerHTML = staff.map(s=>`
    <div class="staff-card-enhanced" data-staff-id="${escAttr(s.id||s.email||s.name)}" data-staff-name="${escAttr(s.name)}" data-staff-email="${escAttr(s.email)}" data-staff-phone="${escAttr(s.phone)}" data-staff-department="${escAttr(s.department)}" data-staff-load="${escAttr(s.current_load)}" data-staff-performance="${escAttr(s.performance)}" data-staff-status="${escAttr(s.status)}">
      <div class="staff-header-new">
        <div class="staff-avatar-new">${(s.name||'').split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase()}</div>
        <div class="staff-info-new">
          <div class="staff-name-row">
            <h4>${s.name || ''}</h4>
            <span class="status-badge ${ (s.status && s.status.toLowerCase()==='active') ? 'active' : 'inactive'}">${s.status||'Unknown'}</span>
          </div>
          <p class="staff-role-new">${s.role || ''}</p>
        </div>
      </div>
      <div class="staff-body-new">
        <div class="contact-row"><span class="icon">📞</span><span>${s.phone || '—'}</span></div>
        <div class="contact-row"><span class="icon">📧</span><span>${s.email || '—'}</span></div>
        <div class="contact-row"><span class="icon">🏢</span><span>${s.department || ''}</span></div>
        <div class="contact-row"><span class="icon">📋</span><span>Current Load: ${s.current_load || 0} tickets</span></div>
        <div class="contact-row"><span class="icon">⭐</span><span>Performance: ${s.performance || '—'}</span></div>
      </div>
      <div class="staff-footer-new">
        <button class="btn-secondary-small" onclick="showStaffDetails(this)">View Details</button>
        <button class="btn-primary-small" onclick="assignTicketToStaff(this)">Assign Ticket</button>
      </div>
    </div>
  `).join('');
}

// Show staff details in the Profile Modal by reading data attributes from the card
function showStaffDetails(buttonEl) {
  try {
    const card = buttonEl.closest('.staff-card-enhanced');
    if (!card) return;
    const modal = document.getElementById('profileModal');
    if (!modal) return;
  const name = card.dataset.staffName || card.querySelector('.staff-info-new h4')?.textContent || '';
  const email = card.dataset.staffEmail || card.querySelector('.contact-row:nth-of-type(2) span:last-child')?.textContent || '';
  const phone = card.dataset.staffPhone || card.querySelector('.contact-row:nth-of-type(1) span:last-child')?.textContent || '';
  const dept = card.dataset.staffDepartment || card.querySelector('.contact-row:nth-of-type(3) span:last-child')?.textContent || '';
    const load = card.dataset.staffLoad || '0';
    const perf = card.dataset.staffPerformance || '—';
    const status = card.dataset.staffStatus || '';

    const avatar = modal.querySelector('.profile-avatar-large');
    const nameEl = modal.querySelector('.profile-name-modal');
    const roleEl = modal.querySelector('.profile-role-modal');
    const idEl = modal.querySelector('.profile-id');
    const infoTexts = modal.querySelectorAll('.profile-info-text');
    const metricValues = modal.querySelectorAll('.profile-metric-value');

    if (avatar) avatar.textContent = (name || '').split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase();
    if (nameEl) nameEl.textContent = name || '—';
    // role may not be on the card; try dataset or leave existing
    if (roleEl) roleEl.textContent = card.dataset.staffRole || card.querySelector('.staff-role-new')?.textContent || '—';
    if (idEl) idEl.textContent = card.dataset.staffId ? `Employee ID: ${card.dataset.staffId}` : '';

    // profile-info-text order: email, phone, department, service zone (if present)
    if (infoTexts && infoTexts.length) {
      if (infoTexts[0]) infoTexts[0].textContent = email || '—';
      if (infoTexts[1]) infoTexts[1].textContent = phone || '—';
      if (infoTexts[2]) infoTexts[2].textContent = dept || '—';
      if (infoTexts[3]) infoTexts[3].textContent = card.dataset.staffZone || '—';
    }

    // metrics: active tickets, resolved this week, avg response, satisfaction
    if (metricValues && metricValues.length) {
      if (metricValues[0]) metricValues[0].textContent = load || '0';
      // leave metricValues[1] (resolved this week) as-is if no data
      if (metricValues[2]) metricValues[2].textContent = card.dataset.staffResponseTime || metricValues[2].textContent;
      if (metricValues[3]) metricValues[3].textContent = perf || metricValues[3].textContent;
    }

    // status badge
    const statusBadge = modal.querySelector('.status-badge');
    if (statusBadge) {
      statusBadge.textContent = status || statusBadge.textContent;
      if ((status||'').toLowerCase() === 'active') {
        statusBadge.classList.add('active'); statusBadge.classList.remove('inactive');
      } else {
        statusBadge.classList.add('inactive'); statusBadge.classList.remove('active');
      }
    }

    // show modal
    modal.classList.remove('hidden');
  } catch (err) {
    console.error('showStaffDetails error', err);
  }
}

function assignTicketToStaff(buttonEl) {
  const card = buttonEl.closest('.staff-card-enhanced');
  if (!card) return showToast('No staff selected', '❌');
  const staffName = card.dataset.staffName || card.querySelector('.staff-info-new h4')?.textContent || 'Staff';
  // For demo, just show confirmation modal / toast. Real implementation would open assignment flow.
  showToast(`Assigning ticket to ${staffName}`, '✅');
}

async function loadStaffList() {
  const listEl = document.getElementById('manageTeamList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="section-card">Loading...</div>';
  try {
    const resp = await apiFetch('/staff');
    if (!resp.ok) throw new Error('Failed to fetch staff');
    const data = await resp.json();
    renderStaffList(listEl, data || []);
  } catch (err) {
    console.error('Could not load staff', err);
    renderStaffList(listEl, (enhancedMunicipalData && enhancedMunicipalData.staffDirectory) ? enhancedMunicipalData.staffDirectory : []);
  }
}

function initManageTeamForm() {
  const form = document.getElementById('manageTeamForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('manageStaffName').value,
      role: document.getElementById('manageStaffRole').value,
      department: document.getElementById('manageStaffDepartment').value,
      municipality: (document.getElementById('municipalitySelect') ? document.getElementById('municipalitySelect').value : undefined),
      phone: document.getElementById('manageStaffPhone').value,
      email: document.getElementById('manageStaffEmail').value
    };
    try {
      const resp = await apiFetch('/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!resp.ok) throw new Error('Create staff failed');
      const data = await resp.json();
      showToast('Staff created', '✅');
      form.reset();
      loadStaffList();
    } catch (err) {
      console.error('Create staff error', err);
      showToast('Failed to create staff', '❌');
    }
  });
}

function selectStaff(name, email) {
  document.getElementById('assignStaffName').value = name;
  document.getElementById('assignStaffEmail').value = email;
  const list = document.getElementById('assignStaffList'); if (list) list.innerHTML = '';
}

function openScheduleModal(ticketId, preType) {
  const modal = document.getElementById('scheduleModal');
  if (!modal) return;
  document.getElementById('scheduleTicketId').value = ticketId || '';
  document.getElementById('scheduleType').value = preType || '';
  document.getElementById('scheduleDate').value = '';
  document.getElementById('scheduleNotes').value = '';
  modal.classList.remove('hidden');
}

function closeScheduleModal() {
  const modal = document.getElementById('scheduleModal');
  if (modal) modal.classList.add('hidden');
}

function initScheduleForm() {
  const form = document.getElementById('scheduleForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      ticket_id: document.getElementById('scheduleTicketId').value,
      schedule_date: document.getElementById('scheduleDate').value,
      schedule_type: document.getElementById('scheduleType').value,
      notes: document.getElementById('scheduleNotes').value,
      scheduled_by: (currentUser && currentUser.email) ? currentUser.email : undefined
    };
    try {
  const resp = await apiFetch('/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!resp.ok) throw new Error('Schedule failed');
      const data = await resp.json();
      showToast('Work scheduled', '📅');
      closeScheduleModal();
      loadTicketsToReportsList();
    } catch (err) {
      console.error('Schedule failed', err);
      showToast('Scheduling failed', '❌');
    }
  });
}

function openServiceHistoryModal(ticketId) {
  const modal = document.getElementById('serviceHistoryModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const list = document.getElementById('serviceHistoryList');
  if (!list) return;
  list.innerHTML = '<div class="section-card">Loading...</div>';
  apiFetch(`/ticket/${ticketId}/schedules`).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
    if (!data || data.length === 0) {
      list.innerHTML = '<div class="section-card">No scheduled work found.</div>';
      return;
    }
    list.innerHTML = data.map(s => `
      <div class="schedule-item">
        <div style="font-weight:700">${s.schedule_type || 'Maintenance'} • ${s.schedule_date}</div>
        <div style="font-size:12px;color:var(--color-text-secondary)">${s.notes || ''}</div>
      </div>
    `).join('');
  }).catch(err=>{
    console.error('Failed to load schedules', err);
    list.innerHTML = '<div class="section-card">Failed to load service history.</div>';
  });
}

function closeServiceHistoryModal() { const modal = document.getElementById('serviceHistoryModal'); if (modal) modal.classList.add('hidden'); }

function updateIssueStatus(issueId, status) {
  showToast(`Issue ${issueId} updated to ${status}`, '✓');
  closeModal();
  
  // Update the issue in mock data
  const issue = mockData.issues.find(i => i.id === issueId);
  if (issue) {
    issue.status = status;
    initPriorityQueue();
  }
}

// Municipal Dashboard
function initPriorityQueue() {
  const queue = document.getElementById('priorityQueue');
  if (!queue) return;
  
  const sortedIssues = [...mockData.issues].sort((a, b) => b.priority - a.priority);
  
  queue.innerHTML = sortedIssues.map(issue => `
    <div class="queue-item" onclick="showIssueModal('${issue.id}')">
      <div class="queue-category">${mockData.categoryIcons[issue.type]}</div>
      <div class="queue-details">
        <div class="queue-id">${getDisplayTicketNumber(issue)}</div>
        <div class="queue-type">${issue.type}</div>
        <div class="queue-meta">
          <span>📍 ${issue.location}</span>
          <span>⏰ ${issue.submitted}</span>
          <span>👤 ${issue.reporter}</span>
        </div>
      </div>
      <div class="queue-priority">
        <span class="priority-score-badge ${getPriorityClass(issue.priority)}">${issue.priority}</span>
        <div style="font-size: 11px; color: var(--color-text-secondary); text-align: center; margin-top: 4px;">${issue.department}</div>
      </div>
      <div class="queue-actions">
        <button class="btn-icon" title="View Details" onclick="event.stopPropagation(); showIssueModal('${issue.id}')">👁️</button>
      </div>
    </div>
  `).join('');
}

function initWorkloadChart() {
  const chart = document.getElementById('workloadChart');
  if (!chart) return;
  
  const maxWorkload = Math.max(...mockData.departments.map(d => d.workload));
  
  chart.innerHTML = mockData.departments.map(dept => `
    <div class="workload-item">
      <div class="workload-label">${dept.name}</div>
      <div class="workload-bar-container">
        <div class="workload-bar" style="width: ${(dept.workload / maxWorkload) * 100}%">
          ${dept.workload}
        </div>
      </div>
      <div class="workload-value">${dept.avg_response}</div>
    </div>
  `).join('');
}

function initPerformanceTable() {
  const table = document.getElementById('performanceTable');
  if (!table) return;
  
  table.innerHTML = mockData.departments.map(dept => `
    <tr>
      <td style="font-weight: 600;">${dept.name}</td>
      <td>${dept.workload}</td>
      <td>${dept.avg_response}</td>
      <td style="color: var(--color-success); font-weight: 700;">4.5/5</td>
    </tr>
  `).join('');
}

function updateTime() {
  const timeElement = document.getElementById('currentTime');
  if (timeElement) {
    const now = new Date();
    timeElement.textContent = now.toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata'
    });
  }
}

// Chart.js Charts
function initCharts() {
  // Ensure we don't leak multiple Chart instances - destroy any previous ones
  if (!window.__charts) window.__charts = {};
  // Category Chart
  const categoryCtx = document.getElementById('categoryChart');
  if (categoryCtx) {
    // destroy existing chart instance if present
    try {
      if (window.__charts['categoryChart']) {
        window.__charts['categoryChart'].destroy();
      }
      // Chart.getChart() is also available in Chart.js v3+
      if (typeof Chart.getChart === 'function') {
        const existing = Chart.getChart(categoryCtx);
        if (existing) existing.destroy();
      }
    } catch (e) { console.warn('Error destroying previous categoryChart', e); }

    window.__charts['categoryChart'] = new Chart(categoryCtx, {
      type: 'doughnut',
      data: {
        labels: ['Pothole', 'Streetlight', 'Dumping', 'Graffiti', 'Water Leak', 'Tree', 'Vehicle', 'Traffic', 'Infrastructure'],
        datasets: [{
          data: [45, 28, 32, 19, 12, 8, 15, 11, 14],
          backgroundColor: [
            '#1FB8CD',
            '#FFC185',
            '#B4413C',
            '#ECEBD5',
            '#5D878F',
            '#DB4545',
            '#D2BA4C',
            '#964325',
            '#944454'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  }
  
  // Resolution Chart
  const resolutionCtx = document.getElementById('resolutionChart');
  if (resolutionCtx) {
    try {
      if (window.__charts['resolutionChart']) window.__charts['resolutionChart'].destroy();
      if (typeof Chart.getChart === 'function') {
        const existing = Chart.getChart(resolutionCtx);
        if (existing) existing.destroy();
      }
    } catch (e) { console.warn('Error destroying previous resolutionChart', e); }
    window.__charts['resolutionChart'] = new Chart(resolutionCtx, {
      type: 'bar',
      data: {
        labels: mockData.departments.map(d => d.name),
        datasets: [{
          label: 'Avg Response Time (hours)',
          data: mockData.departments.map(d => parseFloat(d.avg_response)),
          backgroundColor: '#1FB8CD'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
  
  // Trend Chart
  const trendCtx = document.getElementById('trendChart');
  if (trendCtx) {
    try {
      if (window.__charts['trendChart']) window.__charts['trendChart'].destroy();
      if (typeof Chart.getChart === 'function') {
        const existing = Chart.getChart(trendCtx);
        if (existing) existing.destroy();
      }
    } catch (e) { console.warn('Error destroying previous trendChart', e); }
    window.__charts['trendChart'] = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [
          {
            label: 'Submitted',
            data: [28, 32, 25, 38, 42, 35, 30],
            borderColor: '#2563EB',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Resolved',
            data: [22, 28, 24, 32, 38, 30, 27],
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
}

// Authentication Functions
function showAuthScreen(screenId) {
  document.querySelectorAll('.auth-screen').forEach(screen => {
    screen.classList.remove('active');
  });
  document.getElementById(screenId).classList.add('active');
}

function handleSignIn(event) {
  event.preventDefault();
  
  const email = document.getElementById('signInEmail').value;
  const password = document.getElementById('signInPassword').value;
  
  // Simulate authentication
  showToast('Signing in...', '🔐');
  
  setTimeout(() => {
    // Mock successful login
    currentUser = {
      name: 'Alex Johnson',
      email: email,
      type: 'citizen',
      verified: true
    };
    
    isAuthenticated = true;
    completeAuthentication();
  }, 1000);
}

function handleGoogleSignIn() {
  showToast('Connecting to Google...', '🔐');
  
  setTimeout(() => {
    currentUser = {
      name: 'Alex Johnson',
      email: 'alex.johnson@gmail.com',
      type: 'citizen',
      verified: true,
      authMethod: 'google'
    };
    
    isAuthenticated = true;
    completeAuthentication();
  }, 1500);
}

function nextStep() {
  const currentStepElement = document.querySelector(`.signup-step[data-step="${signupStep}"]`);
  const inputs = currentStepElement.querySelectorAll('input[required], select[required]');
  
  // Validate current step
  let isValid = true;
  inputs.forEach(input => {
    if (!input.value) {
      isValid = false;
      input.focus();
      showToast('Please fill in all required fields', '⚠️');
      return;
    }
  });
  
  if (!isValid) return;
  
  // Check password match on step 1
  if (signupStep === 1) {
    const password = document.getElementById('signUpPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (password !== confirmPassword) {
      showToast('Passwords do not match', '⚠️');
      return;
    }
  }
  
  // Save step data
  inputs.forEach(input => {
    signupData[input.id] = input.value;
  });
  
  if (signupStep < 4) {
    signupStep++;
    updateSignupStep();
    
    // Simulate sending verification codes on step 4
    if (signupStep === 4) {
      showToast('Verification codes sent!', '📧');
    }
  }
}

function previousStep() {
  if (signupStep > 1) {
    signupStep--;
    updateSignupStep();
  }
}

function updateSignupStep() {
  // Update progress indicator
  document.querySelectorAll('.progress-step').forEach((step, index) => {
    step.classList.remove('active', 'completed');
    if (index + 1 < signupStep) {
      step.classList.add('completed');
    } else if (index + 1 === signupStep) {
      step.classList.add('active');
    }
  });
  
  // Update form steps
  document.querySelectorAll('.signup-step').forEach(step => {
    step.classList.remove('active');
  });
  document.querySelector(`.signup-step[data-step="${signupStep}"]`).classList.add('active');
  
  // Update buttons
  const prevBtn = document.getElementById('prevStepBtn');
  const nextBtn = document.getElementById('nextStepBtn');
  const submitBtn = document.getElementById('submitSignUpBtn');
  
  prevBtn.style.display = signupStep > 1 ? 'block' : 'none';
  nextBtn.style.display = signupStep < 4 ? 'block' : 'none';
  submitBtn.style.display = signupStep === 4 ? 'block' : 'none';
}

function handleSignUp(event) {
  event.preventDefault();
  
  const emailCode = document.getElementById('emailVerificationCode').value;
  const smsCode = document.getElementById('smsVerificationCode').value;
  
  if (emailCode.length !== 6 || smsCode.length !== 6) {
    showToast('Please enter valid 6-digit codes', '⚠️');
    return;
  }
  
  showToast('Verifying codes...', '🔐');
  
  setTimeout(() => {
    showToast('Account created successfully!', '✅');
    
    // Reset form
    signupStep = 1;
    signupData = {};
    document.getElementById('signUpForm').reset();
    updateSignupStep();
    
    // Show user type selection
    showAuthScreen('userTypeScreen');
  }, 1500);
}

function handleGoogleSignUp() {
  showToast('Connecting to Google...', '🔐');
  
  setTimeout(() => {
    showToast('Please complete your profile', 'ℹ️');
    // In a real app, would show additional info collection
    showAuthScreen('userTypeScreen');
  }, 1500);
}

function resendCodes(event) {
  event.preventDefault();
  showToast('Verification codes resent!', '📧');
}

function selectUserType(type) {
  if (type === 'municipal') {
    showAuthScreen('municipalVerifyScreen');
  } else {
    currentUser = {
      name: signupData.signUpName || 'Alex Johnson',
      email: signupData.signUpEmail || 'alex.johnson@email.com',
      phone: signupData.signUpPhone,
      type: 'citizen',
      verified: true
    };
    
    isAuthenticated = true;
    completeAuthentication();
  }
}

function handleMunicipalVerify(event) {
  event.preventDefault();
  
  const department = document.getElementById('staffDepartment').value;
  const employeeId = document.getElementById('employeeId').value;
  
  showToast('Application submitted for approval', '✅');
  
  setTimeout(() => {
    // For demo purposes, approve immediately
    currentUser = {
      name: signupData.signUpName || 'Sarah Municipal',
      email: signupData.signUpEmail || 's.municipal@springfield.gov',
      type: 'municipal',
      department: department,
      employeeId: employeeId,
      verified: true
    };
    
    currentMode = 'municipal';
    isAuthenticated = true;
    completeAuthentication();
  }, 1500);
}

function continueAsGuest() {
  showToast('Continuing as guest (limited features)', 'ℹ️');
  isAuthenticated = false;
  currentUser = { type: 'guest' };
  completeAuthentication();
}

// Ensure inline onclick handlers can access this function from the global scope
try { window.continueAsGuest = continueAsGuest; } catch (e) { /* no-op in constrained environments */ }

function completeAuthentication() {
  // Hide auth container
  document.getElementById('authContainer').classList.remove('active');
  
  // Show mode switcher
  document.querySelector('.mode-switcher').style.display = 'flex';
  
  // Show appropriate app
  if (currentUser.type === 'municipal') {
    document.getElementById('municipalModeBtn').click();
  } else {
    document.getElementById('citizenModeBtn').click();
  }
  
  // Update user info in UI
  updateUserInterface();
  
  showToast(`Welcome, ${currentUser.name || 'Guest'}!`, '👋');
}

function updateUserInterface() {
  if (!currentUser) return;
  
  // Update user name
  const userName = currentUser.name || 'Guest User';
  const userNameElements = document.querySelectorAll('.user-name, #userName');
  userNameElements.forEach(el => el.textContent = userName);
  
  // Update avatar
  const initials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  const avatarElements = document.querySelectorAll('.user-avatar, #userAvatar');
  avatarElements.forEach(el => el.textContent = initials);
  
  // Update welcome message
  const welcomeMsg = document.getElementById('welcomeMessage');
  if (welcomeMsg) {
    welcomeMsg.textContent = `Welcome back, ${userName.split(' ')[0]}! 👋`;
  }
  
  // Update location-specific greeting
  const locationGreeting = document.getElementById('userLocationGreeting');
  if (locationGreeting && signupData.signUpMunicipality) {
    locationGreeting.textContent = `Issues in ${signupData.signUpMunicipality}`;
  }
  
  // Update municipality in stats
  const municipalityElement = document.getElementById('userMunicipality');
  if (municipalityElement && signupData.signUpMunicipality) {
    municipalityElement.textContent = signupData.signUpMunicipality;
  }
}

function logout() {
  isAuthenticated = false;
  currentUser = null;
  signupData = {};
  signupStep = 1;
  
  // Hide apps
  document.getElementById('citizenApp').classList.remove('active');
  document.getElementById('municipalApp').classList.remove('active');
  
  // Show auth container
  document.getElementById('authContainer').classList.add('active');
  showAuthScreen('welcomeScreen');
  
  // Hide mode switcher
  document.querySelector('.mode-switcher').style.display = 'none';
  
  showToast('Logged out successfully', '👋');
}

// Password Strength Checker
function checkPasswordStrength() {
  const password = document.getElementById('signUpPassword');
  const strengthIndicator = document.getElementById('passwordStrength');
  
  if (!password || !strengthIndicator) return;
  
  password.addEventListener('input', () => {
    const value = password.value;
    const length = value.length;
    const hasNumbers = /\d/.test(value);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(value);
    const hasUpper = /[A-Z]/.test(value);
    const hasLower = /[a-z]/.test(value);
    
    let strength = 0;
    if (length >= 8) strength++;
    if (hasNumbers) strength++;
    if (hasSpecial) strength++;
    if (hasUpper && hasLower) strength++;
    
    strengthIndicator.classList.remove('weak', 'medium', 'strong');
    
    if (strength <= 1) {
      strengthIndicator.classList.add('weak');
    } else if (strength <= 3) {
      strengthIndicator.classList.add('medium');
    } else {
      strengthIndicator.classList.add('strong');
    }
  });
}

// Settings Modal Functions
function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    console.log('Settings modal opened');
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function saveSettings() {
  showToast('Settings saved successfully!', '✅');
  closeSettingsModal();
}

// Profile Modal Functions
function openProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    console.log('Profile modal opened');
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

// View All Alerts Functions
function showViewAllAlerts() {
  const modal = document.getElementById('viewAllAlertsModal');
  const alertsList = document.getElementById('allAlertsList');
  
  const allAlerts = [
    {
      type: 'Seasonal Maintenance',
      description: 'Pothole formation likely in North District based on weather patterns and historical data',
      priority: 'Medium',
      timeline: 'Next 2 weeks',
      cost: '$2,400',
      icon: '🚧'
    },
    {
      type: 'Equipment Maintenance',
      description: 'Sanitation truck #7 due for service - schedule before breakdown',
      priority: 'High',
      timeline: '3 days',
      cost: '$450',
      icon: '🚛'
    },
    {
      type: 'Infrastructure Alert',
      description: 'Bridge inspection required on Elm St',
      priority: 'High',
      timeline: '1 week',
      cost: '$1,200',
      icon: '🌉'
    },
    {
      type: 'Seasonal Maintenance',
      description: 'Tree trimming needed in Central Park',
      priority: 'Low',
      timeline: 'Next month',
      cost: '$3,500',
      icon: '🌳'
    },
    {
      type: 'Equipment Maintenance',
      description: 'Traffic signal controller replacement at Main & 5th',
      priority: 'Medium',
      timeline: '10 days',
      cost: '$890',
      icon: '🚦'
    },
    {
      type: 'Infrastructure Alert',
      description: 'Sidewalk repair needed on Park Avenue',
      priority: 'Low',
      timeline: '3 weeks',
      cost: '$1,800',
      icon: '🚶'
    }
  ];
  
  // helper to render alerts array into the list
  function renderAlerts(alerts) {
    alertsList.innerHTML = alerts.map(alert => `
    <div class="alert-card ${alert.priority.toLowerCase()}">
      <div class="alert-icon">${alert.icon}</div>
      <div class="alert-content">
        <div class="alert-type">${alert.type}</div>
        <div class="alert-description">${alert.description}</div>
        <div class="alert-footer">
          <span>📅 ${alert.timeline}</span>
          <span>💰 Prevention cost: ${alert.cost}</span>
          <span class="priority-score-badge priority-${alert.priority.toLowerCase()}">${alert.priority}</span>
        </div>
      </div>
      <div class="alert-actions">
        <button class="btn btn-primary btn-sm" onclick="scheduleAlert()">Schedule</button>
        <button class="btn btn-outline btn-sm" onclick="dismissAlert()">Dismiss</button>
      </div>
    </div>
  `).join('');
  }

  renderAlerts(allAlerts);

  // wire filters in the modal to filter client-side
  const typeSelect = modal.querySelector('.alerts-filters select:nth-child(1)');
  const prioritySelect = modal.querySelector('.alerts-filters select:nth-child(2)');
  if (typeSelect || prioritySelect) {
    const applyFilters = () => {
      const t = typeSelect ? typeSelect.value : 'All Types';
      const p = prioritySelect ? prioritySelect.value : 'All Priorities';
      const filtered = allAlerts.filter(a => (t === 'All Types' || a.type === t) && (p === 'All Priorities' || a.priority === p));
      renderAlerts(filtered);
    };
    typeSelect && typeSelect.addEventListener('change', applyFilters);
    prioritySelect && prioritySelect.addEventListener('change', applyFilters);
  }

  modal.classList.remove('hidden');
}

function closeViewAllAlerts() {
  document.getElementById('viewAllAlertsModal').classList.add('hidden');
}

function scheduleAlert() {
  // Open schedule modal prefilled for predictive maintenance
  try {
    openScheduleModal('', 'Predictive Maintenance');
  } catch (e) {
    showToast('Alert scheduled successfully', '✅');
  }
}

function dismissAlert() {
  showToast('Alert dismissed', '🗑️');
}

// Manage Team Functions
function showManageTeam() {
  const modal = document.getElementById('manageTeamModal');
  const teamList = document.getElementById('teamMembersList');
  
  const teamMembers = [
    {
      name: 'John Smith',
      initials: 'JS',
      role: 'Public Works Supervisor',
      department: 'Public Works',
      phone: '+1-555-0789',
      email: 'j.smith@city.gov',
      load: 8,
      status: 'Active',
      zone: 'North District'
    },
    {
      name: 'Maria Garcia',
      initials: 'MG',
      role: 'Sanitation Coordinator',
      department: 'Sanitation',
      phone: '+1-555-0321',
      email: 'm.garcia@city.gov',
      load: 5,
      status: 'Active',
      zone: 'Central District'
    },
    {
      name: 'Robert Chen',
      initials: 'RC',
      role: 'Traffic Engineer',
      department: 'Traffic Management',
      phone: '+1-555-0456',
      email: 'r.chen@city.gov',
      load: 12,
      status: 'Active',
      zone: 'Downtown'
    },
    {
      name: 'Emily Davis',
      initials: 'ED',
      role: 'Parks Supervisor',
      department: 'Parks & Recreation',
      phone: '+1-555-0654',
      email: 'e.davis@city.gov',
      load: 6,
      status: 'Active',
      zone: 'West District'
    },
    {
      name: 'Michael Torres',
      initials: 'MT',
      role: 'Utilities Manager',
      department: 'Utilities',
      phone: '+1-555-0987',
      email: 'm.torres@city.gov',
      load: 4,
      status: 'Active',
      zone: 'South District'
    },
    {
      name: 'Sarah Johnson',
      initials: 'SJ',
      role: 'Code Enforcement Officer',
      department: 'Code Enforcement',
      phone: '+1-555-0234',
      email: 's.johnson@city.gov',
      load: 9,
      status: 'Active',
      zone: 'East District'
    }
  ];
  
  teamList.innerHTML = teamMembers.map(member => `
    <div class="team-member-card">
      <div class="team-member-avatar">${member.initials}</div>
      <div class="team-member-info">
        <div class="team-member-name">${member.name}</div>
        <div class="team-member-role">${member.role}</div>
        <div class="team-member-meta">
          <span>📞 ${member.phone}</span>
          <span>📧 ${member.email}</span>
          <span>📊 Load: ${member.load} tickets</span>
          <span>📍 ${member.zone}</span>
        </div>
      </div>
      <div class="team-member-actions">
        <button class="btn btn-outline btn-sm" onclick="editTeamMember('${member.name}')">✏️ Edit</button>
        <button class="btn btn-primary btn-sm" onclick="viewMemberPerformance('${member.name}')">View Stats</button>
      </div>
    </div>
  `).join('');
  
  modal.classList.remove('hidden');
}

function closeManageTeam() {
  document.getElementById('manageTeamModal').classList.add('hidden');
}

function showAddStaffForm() {
  showToast('Add Staff form would open here', '➕');
}

function editTeamMember(name) {
  showToast(`Editing ${name}`, '✏️');
}

function viewMemberPerformance(name) {
  showToast(`Viewing performance for ${name}`, '📊');
}

// Password visibility toggle
function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  const button = input.nextElementSibling;
  
  if (input.type === 'password') {
    input.type = 'text';
    button.querySelector('.toggle-icon').textContent = '👁️';
  } else {
    input.type = 'password';
    button.querySelector('.toggle-icon').textContent = '👁️';
  }
}

// Enhanced Municipal Features
const enhancedMunicipalData = {
  executiveMetrics: {
    criticalAlerts: 3,
    dailyReports: 47,
    satisfaction: 4.7,
    costSavings: 45600,
    aiAutomation: 94.2,
    responseEfficiency: '+23%'
  },
  
  predictiveAlerts: [
    {
      type: 'Seasonal Maintenance',
      description: 'Pothole formation likely in North District',
      priority: 'Medium',
      date: 'Next 2 weeks',
      cost: '$2,400'
    },
    {
      type: 'Equipment Maintenance',
      description: 'Sanitation truck #7 due for service',
      priority: 'High',
      date: '3 days',
      cost: '$450'
    }
  ],
  
  staffDirectory: [
    {
      name: 'John Smith',
      role: 'Public Works Supervisor',
      department: 'Public Works',
      phone: '+1-555-0789',
      status: 'Active',
      currentLoad: 8
    },
    {
      name: 'Maria Garcia',
      role: 'Sanitation Coordinator',
      department: 'Sanitation',
      phone: '+1-555-0321',
      status: 'Active',
      currentLoad: 5
    }
  ],
  
  equipmentTracking: [
    {
      item: 'Pothole Repair Truck #3',
      department: 'Public Works',
      status: 'In Use',
      location: 'North District',
      maintenanceDue: '2024-11-15'
    },
    {
      item: 'Street Sweeper #1',
      department: 'Sanitation',
      status: 'Available',
      location: 'Municipal Garage',
      maintenanceDue: '2024-12-01'
    }
  ]
};

function initEnhancedMunicipalDashboard() {
  // This would add enhanced features to the municipal dashboard
  // For brevity, keeping the existing implementation
  initPriorityQueue();
  initWorkloadChart();
  initPerformanceTable();
  initCharts();
}

// Initialize signup form on load
function initSignupForm() {
  signupStep = 1;
  updateSignupStep();
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Mode Switcher
  document.getElementById('citizenModeBtn').addEventListener('click', () => {
    currentMode = 'citizen';
    document.getElementById('citizenModeBtn').classList.add('active');
    document.getElementById('municipalModeBtn').classList.remove('active');
    document.getElementById('citizenApp').classList.add('active');
    document.getElementById('municipalApp').classList.remove('active');
    // hide manage team button when in citizen mode
    const manageBtn = document.getElementById('manageTeamBtn'); if (manageBtn) manageBtn.classList.add('hidden');
  });
  
  document.getElementById('municipalModeBtn').addEventListener('click', () => {
    currentMode = 'municipal';
    document.getElementById('municipalModeBtn').classList.add('active');
    document.getElementById('citizenModeBtn').classList.remove('active');
    document.getElementById('municipalApp').classList.add('active');
    document.getElementById('citizenApp').classList.remove('active');
    
    // Initialize municipal dashboard
    initPriorityQueue();
    initWorkloadChart();
    initPerformanceTable();
    initCharts();
    updateTime();
    setInterval(updateTime, 60000);
    // show manage team button in municipal mode
    const manageBtn = document.getElementById('manageTeamBtn'); if (manageBtn) manageBtn.classList.remove('hidden');
    // initialize manage team form handlers once
    setTimeout(() => initManageTeamForm(), 100);
  });
  
  // Bottom Navigation
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.view);
    });
  });
  
  // Sidebar Navigation
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    if (item.dataset.view) {
      item.addEventListener('click', () => {
        navigateTo(item.dataset.view);
      });
    }
  });
  
  // FAB Button
  const fab = document.getElementById('reportIssueFab');
  if (fab) {
    fab.addEventListener('click', () => {
      navigateTo('reportIssue');
    });
  }

  // Populate municipality dropdown from backend, fallback to existing options
  const muniEl = document.getElementById('municipalitySelect');
  // There may be multiple UI spots showing the selected municipality; update all of them
  const userMuniEls = Array.from(document.querySelectorAll('[id="userMunicipality"]'));

  async function populateMunicipalities() {
    if (!muniEl) return;
    // try fetching from backend
    try {
      const res = await fetch('/municipalities');
      if (res.ok) {
        const data = await res.json();
        // clear existing options
        muniEl.innerHTML = '';
        // data is expected to be a mapping code->name
        for (const [code, name] of Object.entries(data)) {
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = `${name} (${code})`;
          muniEl.appendChild(opt);
        }
      }
    } catch (err) {
      console.warn('Could not fetch municipalities, leaving default options', err);
    }

    // set initial display and wire change handler
    const setUserMuniText = () => {
      const txt = muniEl.options[muniEl.selectedIndex] ? muniEl.options[muniEl.selectedIndex].text : muniEl.value;
      userMuniEls.forEach(el => el.textContent = txt);
    };
    if (muniEl.options.length > 0) setUserMuniText();
    muniEl.addEventListener('change', () => setUserMuniText());
  }

  // populate municipalities before initializing lists so filters apply
  populateMunicipalities().catch(e => console.warn(e));

  // Lightweight i18n: minimal strings for English and Telugu (telugu is partial)
  const I18N = {
    en: {
      issueCategory: 'Issue Category',
      municipality: 'Municipality',
      descriptionPlaceholder: 'Describe the issue in detail...',
      submitReport: 'Submit Report',
      phoneLabel: 'Phone (optional)',
      wardLabel: 'Ward / Zone (optional)',
      consentLabel: 'I consent to share my contact details with the municipality',
      languageLabel: 'Language'
    },
    te: {
      issueCategory: 'సమస్య వర్గం',
      municipality: 'మునిసిపాలిటీ',
      descriptionPlaceholder: 'సమస్యను విపులంగా వివరించండి...',
      submitReport: 'రిపోర్ట్‌ సమర్పించండి',
      phoneLabel: 'ఫోన్ (ఐచ్ఛికం)',
      wardLabel: 'వార్డు / జోన్ (ఐచ్ఛికం)',
      consentLabel: 'నా సంప్రదింపు వివరాలను మునిసిపాలిటీతో పంచుకోవడానికి నేను సమ్మతిస్తున్నాను',
      languageLabel: 'భాష'
    }
  };

  function applyLocale(lang) {
    const vals = I18N[lang] || I18N.en;
    // set button
    const submitBtn = document.getElementById('submitReportBtn');
    if (submitBtn) {
      submitBtn.innerHTML = `<span>${vals.submitReport}</span><span class="points-badge">+50 Points</span>`;
    }
    // labels and placeholders
    const desc = document.getElementById('issueDescription'); if (desc) desc.placeholder = vals.descriptionPlaceholder;
    // update phone and ward labels robustly
    const phoneLabel = document.querySelector('label[for="reporterPhone"]') || (document.querySelector('#reporterPhone') && document.querySelector('#reporterPhone').previousElementSibling);
    if (phoneLabel) phoneLabel.textContent = vals.phoneLabel;
    const wardLabel = document.querySelector('label[for="reporterWard"]') || (document.querySelector('#reporterWard') && document.querySelector('#reporterWard').previousElementSibling);
    if (wardLabel) wardLabel.textContent = vals.wardLabel;
    // consent label
    const consentLabelEl = document.querySelector('#consentCheckbox') && document.querySelector('#consentCheckbox').parentElement;
    if (consentLabelEl) {
      const chk = document.querySelector('#consentCheckbox');
      consentLabelEl.innerHTML = '';
      consentLabelEl.appendChild(chk);
      consentLabelEl.appendChild(document.createTextNode(' ' + vals.consentLabel));
    }
  }

  const langSelect = document.getElementById('langSelect');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      applyLocale(e.target.value || 'en');
    });
    // apply initial
    applyLocale(langSelect.value || 'en');
  }
  
  // Filter Chips
  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      showToast(`Filter: ${chip.textContent}`, '🔍');
    });
  });
  
  // Initialize password strength checker
  checkPasswordStrength();
  
  // Profile Dropdown Handler - CRITICAL FIX
  const municipalProfileBtn = document.getElementById('municipalProfileBtn');
  const profileDropdownMenu = document.getElementById('profileDropdownMenu');
  
  if (municipalProfileBtn && profileDropdownMenu) {
    municipalProfileBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      profileDropdownMenu.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
      if (!municipalProfileBtn.contains(e.target) && !profileDropdownMenu.contains(e.target)) {
        profileDropdownMenu.classList.remove('show');
      }
    });
  }

  // Notifications button: open alerts modal (bell icon)
  const notificationsBtn = document.getElementById('notificationsBtn');
  if (notificationsBtn) {
    notificationsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      try { showViewAllAlerts(); } catch (err) { console.warn('showViewAllAlerts failed', err); }
    });
  }

  const notificationsBtn2 = document.getElementById('notificationsBtn2');
  if (notificationsBtn2) {
    notificationsBtn2.addEventListener('click', (e) => {
      e.preventDefault();
      try { showViewAllAlerts(); } catch (err) { console.warn('showViewAllAlerts failed', err); }
    });
  }

  // Staff card action delegation: make small buttons functional without editing HTML
  document.body.addEventListener('click', function(e) {
    const btn = e.target.closest && e.target.closest('button');
    if (!btn) return;
    // handle staff card small buttons (delegated)
    if (btn.classList.contains('btn-secondary-small') || btn.classList.contains('btn-primary-small')) {
      const card = btn.closest('.staff-card-enhanced');
      if (!card) return;
      e.stopPropagation();

      // read embedded staff data
      const staffData = {
        id: card.dataset.staffId,
        name: card.dataset.staffName,
        email: card.dataset.staffEmail,
        phone: card.dataset.staffPhone,
        department: card.dataset.staffDepartment,
        load: card.dataset.staffLoad,
        performance: card.dataset.staffPerformance,
        status: card.dataset.staffStatus
      };

      // mark selection visually and sync to other UI boxes
      selectStaffCard(card, staffData);

      if (btn.classList.contains('btn-secondary-small')) {
        // View Details — open detail modal
        viewStaffDetails(staffData, card);
      } else {
        // Assign Ticket — open assign modal prefilled
        try {
          openAssignModal('', staffData.name || '', staffData.email || '');
        } catch (err) {
          // fallback: show toast
          showToast('Open assign modal', '🔧');
        }
      }
      return;
    }
  });

  // Simple handlers for staff actions
  function viewStaffDetails(name, card) {
    // legacy wrapper kept for compatibility
    const staffName = (typeof name === 'string') ? name : (name && name.name) || 'Staff';
    const cardEl = (card && card.closest) ? card : (document.querySelector(`.staff-card-enhanced[data-staff-name="${staffName}"]`));
    const details = cardEl ? {
      name: cardEl.dataset.staffName,
      email: cardEl.dataset.staffEmail,
      phone: cardEl.dataset.staffPhone,
      department: cardEl.dataset.staffDepartment,
      load: cardEl.dataset.staffLoad,
      performance: cardEl.dataset.staffPerformance,
      status: cardEl.dataset.staffStatus
    } : { name: staffName };

    // Build a simple details modal dynamically
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal';
    modalOverlay.style.zIndex = 1100;

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content modal-small';

    modalContent.innerHTML = `
      <div class="modal-header"><h2>Staff Details</h2><button class="modal-close">×</button></div>
      <div class="modal-body">
        <h3 style="margin-top:0">${details.name || ''}</h3>
        <div class="small-meta">${details.department || ''} • ${details.status || ''}</div>
        <div style="margin-top:12px">📞 ${details.phone || '—'}</div>
        <div>✉️ ${details.email || '—'}</div>
        <div style="margin-top:8px">📊 Performance: ${details.performance || '—'} • Load: ${details.load || '0'}</div>
      </div>
      <div class="modal-actions" style="padding:16px">
        <button class="btn btn-outline" id="staffDetailClose">Close</button>
        <button class="btn btn-primary" id="staffDetailAssign">Assign Ticket</button>
      </div>
    `;

    modalOverlay.appendChild(modalContent);
    document.body.appendChild(modalOverlay);

    // event handlers
    modalOverlay.querySelector('.modal-close').addEventListener('click', () => modalOverlay.remove());
    modalOverlay.querySelector('#staffDetailClose').addEventListener('click', () => modalOverlay.remove());
    modalOverlay.querySelector('#staffDetailAssign').addEventListener('click', () => {
      openAssignModal('', details.name || '', details.email || '');
      modalOverlay.remove();
    });
    // allow clicking overlay to dismiss
    modalOverlay.addEventListener('click', (ev) => { if (ev.target === modalOverlay) modalOverlay.remove(); });
  }

  function assignTicketToStaff(name) {
    // Open the Assign modal prefilled with staff name
    try { openAssignModal('', name); } catch (e) { console.warn('openAssignModal failed', e); }
  }

  // Select a staff card visually and sync selection to assign inputs and other UI places
  function selectStaffCard(card, staffData) {
    // remove previous selection
    document.querySelectorAll('.staff-card-enhanced.staff-card-selected').forEach(c=>c.classList.remove('staff-card-selected'));
    if (card && card.classList) card.classList.add('staff-card-selected');
    // sync to assign inputs if present
    if (staffData && (staffData.name || staffData.email)) {
      try {
        const nameInput = document.getElementById('assignStaffName');
        const emailInput = document.getElementById('assignStaffEmail');
        if (nameInput && staffData.name) nameInput.value = staffData.name;
        if (emailInput && staffData.email) emailInput.value = staffData.email;
      } catch (e) { /* ignore */ }
    }
  }

  // Equipment actions: add global handlers (buttons have no onclicks in markup)
  document.body.addEventListener('click', function(e) {
    const el = e.target.closest && e.target.closest('button');
    if (!el) return;
    // detect some equipment action buttons by their text
    const text = (el.textContent || '').toLowerCase();
    if (text.includes('schedule maintenance')) { e.stopPropagation(); scheduleMaintenance(); }
    if (text.includes('schedule service')) { e.stopPropagation(); scheduleService(); }
    if (text.includes('service history') || text.includes('view history')) { e.stopPropagation(); viewServiceHistory(); }
    if (text.includes('deploy asset')) { e.stopPropagation(); deployAsset(); }
  });

  function scheduleMaintenance() { try { openScheduleModal(); } catch (e) { showToast('Schedule Maintenance dialog (prototype)', '📅'); } }
  function scheduleService() { try { openScheduleModal(); } catch (e) { showToast('Schedule Service dialog (prototype)', '🔧'); } }
  function viewServiceHistory(ticketId) { try { openServiceHistoryModal(ticketId); } catch (e) { showToast('Service history (prototype)', '📋'); } }
  function deployAsset() { showToast('Deploy asset (prototype)', '🚀'); }
  

  
  // Settings button handler for analytics page
  const settingsBtn2 = document.getElementById('settingsBtn2');
  if (settingsBtn2) {
    settingsBtn2.addEventListener('click', openSettingsModal);
  }
  
  // Profile button handler for analytics page
  const profileBtn2 = document.getElementById('profileBtn2');
  if (profileBtn2) {
    profileBtn2.addEventListener('click', openProfileModal);
  }
  
  // Search button handler
  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', function() {
      showToast('Search functionality', '🔍');
    });
  }
  
  // Settings navigation
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      
      // Update nav items
      document.querySelectorAll('.settings-nav-item').forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Update tabs
      document.querySelectorAll('.settings-tab').forEach(tabContent => tabContent.classList.remove('active'));
      document.querySelector(`.settings-tab[data-tab="${tab}"]`).classList.add('active');
    });
  });
  
  // Initialize Components
  initActivityFeed();
  initReportsList();
  initLeaderboard();
  initPhotoUpload();
  initSubmitReport();
  initContactForm();
  initAssignForm();
  initScheduleForm();
  initPriorityQueue();
  initWorkloadChart();
  initPerformanceTable();
  initCharts();
  updateTime();
  setInterval(updateTime, 60000);
  // Start SSE for real-time updates
  try { initSSE(); } catch (e) { console.warn('SSE init failed', e); }
  
  // Show auth screen on load
  if (!isAuthenticated) {
    document.getElementById('authContainer').classList.add('active');
    document.querySelector('.mode-switcher').style.display = 'none';
    // Initialize signup form to ensure step 1 is active
    initSignupForm();
  }
  
  // Close modals on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeSettingsModal();
      closeProfileModal();
      closeModal();
      closeViewAllAlerts();
      closeManageTeam();
    }
  });
});