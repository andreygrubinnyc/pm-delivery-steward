const projectSelector = document.getElementById('project-selector');
const mainNav = document.getElementById('main-nav');
const aiModeEl = document.getElementById('ai-mode');
const mainTitle = document.getElementById('main-title');
const mainSubtitle = document.getElementById('main-subtitle');
const overviewPanel = document.getElementById('overview-panel');
const portfolioPanel = document.getElementById('portfolio-panel');
const storiesPanel = document.getElementById('stories-panel');
const trackingPanel = document.getElementById('tracking-panel');
const timelinePanel = document.getElementById('timeline-panel');
const transcriptsPanel = document.getElementById('transcripts-panel');
const reportsPanel = document.getElementById('reports-panel');
const teamsPanel = document.getElementById('teams-panel');
const managePanel = document.getElementById('manage-panel');
const helpPanel = document.getElementById('help-panel');
const helpButton = document.getElementById('help-button');
const quickCaptureButton = document.getElementById('quick-capture-button');
const navButtons = document.querySelectorAll('.nav-item');
const sidebarToggle = document.getElementById('sidebar-toggle');
const appElement = document.getElementById('app');

// Header title + scope shown per screen.
const SCREEN_META = {
  overview:    { title: 'Today', scope: 'project workspace' },
  portfolio:   { title: 'Portfolio',    scope: 'all projects' },
  stories:     { title: 'Work Items',   scope: 'selected project' },
  tracking:    { title: 'Follow-Up',    scope: 'Jira work queue' },
  timeline:    { title: 'Milestones',   scope: 'selected project' },
  transcripts: { title: 'Capture',      scope: 'selected project' },
  reports:     { title: 'Communicate',   scope: 'grounded drafts' },
  teams:       { title: 'Teams Draft',  scope: 'selected project' },
  manage:      { title: 'Settings',     scope: 'workspace + AI' },
  help:        { title: 'Help',         scope: '' }
};
let currentTab = 'overview';
let aiProvider = null;
let showNewProjectForm = false;

let selectedProject = null;
let projects = {};
let manageSearch = '';
let manageProjectFilter = '';
let manageTypeFilter = '';
let manageSortKey = 'date';
let manageSortDirection = 'desc';
let manageEditing = null;
let manageEditData = {};
let trackingFilter = 'all';
let trackingSearch = '';
let trackingGroupByOwner = false;
let trackingCommentBannerDismissed = false;
let trackingShowAddForm = false;
let trackingProjectFilter = 'all';
let aiPrompts = { dsuExtraction: '', statusReport: '' };
let aiPromptStatus = '';
let settings = { commentStaleDays: 7, sprintOptions: [] };
let projectStatusReport = '';
let projectStatusSource = '';
let statusReportLoading = false;
let statusReportLoadingMode = '';
let statusReportError = '';
let teamsSelectedStories = new Set();
let teamsRecipient = '';
let teamsSubject = '';
let teamsMessage = '';
let teamsSource = '';
let teamsLoading = false;
let teamsLoadingMode = '';
let teamsError = '';
let teamsAssigneeFilter = 'all';
let teamsStatusFilter = 'all';
let teamsSprintFilter = 'all';
let teamsSearch = '';
let editingProjectDesc = false;
let storyEditing = null;
let transcriptEditing = null;
let storyShowAddForm = false;
let storyShowImportForm = false;
let storyImportPreview = null;
let storyImportError = '';
let storyImportLoading = false;
let storyStatusFilter = 'all';
let storyAssigneeFilter = 'all';
let storySprintFilter = 'all';
let storySearch = '';
let workItemExpanded = new Set();
let trackingExpanded = new Set();
let captureFocus = '';
let captureSelectedFiles = [];
let captureUploadFeedback = null;

async function saveRequest(url, options) {
  try {
    const response = await fetch(url, options);
    if (response.ok) return response;
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  } catch (error) {
    alert(error.message || 'Your changes could not be saved.');
    return null;
  }
}

const ASSIGNEE_DIRECTORY_STARTER = {
  arivera: 'Alex Rivera',
  jchen: 'Jamie Chen',
  tmorgan: 'Taylor Morgan'
};

const PROJECT_STATUS_MAPPING_STARTER = {
  Backlog: 'Planned',
  'Requirements Gathering': 'Planned',
  'Data Architecture': 'Planned',
  'Data Governance': 'Planned',
  'Ready for Dev': 'Planned',
  'In Dev': 'In progress',
  'Dev Peer Review': 'In progress',
  'QA Testing': 'In progress',
  'Prod Deployment': 'In progress',
  Qlik: 'Planned',
  Blocked: 'Blocked',
  Closed: 'Done'
};

const STORY_TEMPLATES = [
  {
    id: 'delivery',
    name: 'Delivery work item',
    description: 'Describe the delivery outcome, the affected scope, and the evidence that confirms completion.',
    acceptanceCriteria: ['Scope and owner are recorded', 'Delivery evidence is linked or noted', 'Dependencies and risks are documented'],
    labels: 'planned'
  },
  {
    id: 'requirement',
    name: 'Requirement',
    description: 'As a stakeholder, I need this requirement clarified so the team can build and validate the intended outcome.',
    acceptanceCriteria: ['Business rule is documented', 'Acceptance criteria are testable', 'Open questions and dependencies are captured'],
    labels: 'planned, requirements'
  },
  {
    id: 'defect',
    name: 'Defect / blocker',
    description: 'Describe the observed issue, impacted workflow, and current workaround.',
    acceptanceCriteria: ['Root cause or owning team is identified', 'Resolution is validated', 'Jira follow-up note is recorded'],
    labels: 'blocked'
  }
];

async function fetchProjects() {
  const response = await fetch('/api/projects');
  projects = await response.json();
  await fetchAiPrompts();
  await fetchSettings();
  await fetchMeta();
  renderProjectSelector();
  if (!selectedProject && Object.keys(projects).length > 0) {
    selectProject(Object.keys(projects)[0]);
  } else {
    renderNavBadges();
  }
}

async function fetchMeta() {
  try {
    const response = await fetch('/api/meta');
    if (response.ok) {
      const meta = await response.json();
      aiProvider = meta.provider || null;
    }
  } catch (error) {
    aiProvider = null;
  }
  if (aiModeEl) {
    aiModeEl.textContent = aiProvider ? `${aiProvider} mode · key set` : 'heuristic mode · no AI key';
  }
}

async function fetchAiPrompts() {
  try {
    const response = await fetch('/api/ai/prompts');
    if (!response.ok) throw new Error('Unable to load AI prompts');
    aiPrompts = await response.json();
  } catch (error) {
    console.warn('Failed to fetch AI prompts:', error.message);
    aiPrompts = { dsuExtraction: '', statusReport: '' };
  }
}

async function fetchSettings() {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) throw new Error('Unable to load settings');
    settings = await response.json();
  } catch (error) {
    console.warn('Failed to fetch settings:', error.message);
    settings = { commentStaleDays: 7, sprintOptions: [] };
  }
}

async function saveAiPrompts() {
  const statusTextarea = document.getElementById('ai-prompt-status-report');
  if (!statusTextarea) return;

  const statusPromptText = statusTextarea.value;
  const response = await fetch('/api/ai/prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statusReport: statusPromptText })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unable to save prompts' }));
    aiPromptStatus = `Failed to save prompts: ${error.error || 'Unknown error'}`;
  } else {
    aiPrompts = await response.json();
    aiPromptStatus = 'Prompts saved successfully.';
  }
  managePanel.innerHTML = renderManagePanel();
}

async function saveWorkspaceSettings() {
  const staleEl = document.getElementById('settings-comment-stale-days');
  const sprintEl = document.getElementById('settings-sprint-options');
  if (!staleEl || !sprintEl) return;
  const commentStaleDays = parseInt(staleEl.value, 10);
  const sprintOptions = sprintEl.value.split('\n').map(value => value.trim()).filter(Boolean);
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentStaleDays, sprintOptions })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unable to save workspace settings' }));
    alert(error.error || 'Unable to save workspace settings');
    return;
  }
  settings = await response.json();
  renderPanels();
}

async function saveAssigneeDirectory() {
  if (!selectedProject) return;
  const input = document.getElementById('project-assignee-directory');
  if (!input) return;
  const entries = [];
  const invalid = [];
  input.value.split('\n').forEach((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return;
    const separator = value.indexOf('=');
    if (separator < 1 || !value.slice(separator + 1).trim()) { invalid.push(index + 1); return; }
    entries.push({ alias: value.slice(0, separator).trim(), name: value.slice(separator + 1).trim() });
  });
  if (invalid.length) { alert(`Use one alias = Full Name entry per line. Check line${invalid.length === 1 ? '' : 's'} ${invalid.join(', ')}.`); return; }
  const response = await fetch('/api/project/assignee-directory', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, entries, applyExisting: true })
  });
  const result = await response.json().catch(() => ({ error: 'Unable to save assignee directory' }));
  if (!response.ok) { alert(result.error || 'Unable to save assignee directory'); return; }
  await refreshProject();
  alert(`Assignee directory saved. ${result.updated} existing work item${result.updated === 1 ? '' : 's'} updated.`);
}

async function saveProjectStatusMappings() {
  if (!selectedProject) return;
  const input = document.getElementById('project-status-mappings');
  if (!input) return;
  const allowed = new Set(['Blocked', 'In progress', 'Active', 'Planned', 'Done', 'Not started']);
  const entries = [];
  const invalid = [];
  input.value.split('\n').forEach((line, index) => {
    const value = line.trim();
    if (!value || value.startsWith('#')) return;
    const separator = value.indexOf('=');
    const jiraStatus = value.slice(0, separator).trim();
    const operatingStatus = value.slice(separator + 1).trim();
    if (separator < 1 || !allowed.has(operatingStatus)) { invalid.push(index + 1); return; }
    entries.push({ jiraStatus, operatingStatus });
  });
  if (invalid.length) {
    alert(`Use Jira Status = one of: Blocked, In progress, Active, Planned, Done, Not started. Check line${invalid.length === 1 ? '' : 's'} ${invalid.join(', ')}.`);
    return;
  }
  const response = await fetch('/api/project/status-mappings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, entries, applyExisting: true })
  });
  const result = await response.json().catch(() => ({ error: 'Unable to save status mappings' }));
  if (!response.ok) { alert(result.error || 'Unable to save status mappings'); return; }
  await refreshProject();
  alert(`Status mappings saved. ${result.updated} existing work item${result.updated === 1 ? '' : 's'} updated.`);
}

async function generateStatusReport(mode = 'heuristic') {
  if (!selectedProject) {
    statusReportError = 'Select a project first to generate its status report.';
    reportsPanel.innerHTML = renderReportsPanel();
    return;
  }

  statusReportLoading = true;
  statusReportLoadingMode = mode;
  projectStatusReport = '';
  projectStatusSource = '';
  statusReportError = '';
  reportsPanel.innerHTML = renderReportsPanel();

  try {
    const response = await fetch('/api/project/status-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: selectedProject, mode })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to generate report' }));
      throw new Error(error.error || 'Unable to generate report');
    }
    const result = await response.json();
    projectStatusReport = result.report || '';
    projectStatusSource = result.source || 'unknown';
  } catch (error) {
    statusReportError = error.message;
  } finally {
    statusReportLoading = false;
    statusReportLoadingMode = '';
    reportsPanel.innerHTML = renderReportsPanel();
  }
}

async function refreshProject() {
  const previouslySelected = selectedProject;
  await fetchProjects();
  if (previouslySelected && projects[previouslySelected]) {
    selectProject(previouslySelected);
  } else if (Object.keys(projects).length > 0) {
    selectProject(Object.keys(projects)[0]);
  } else {
    selectedProject = null;
    renderPanels();
  }
}

// Sidebar project area: dropdown to switch projects only.
function renderProjectSelector() {
  const projectNames = Object.keys(projects);
  const options = projectNames.length
    ? projectNames.map(name => `<option value="${escapeHtml(name)}" ${selectedProject === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')
    : '<option value="">No projects yet</option>';

  projectSelector.innerHTML = `
    <select onchange="selectProject(this.value)" ${projectNames.length ? '' : 'disabled'}>${options}</select>`;
}

// Left-menu notification: the Tracking nav item shows how many tracked items have "gone
// quiet" (no comment past the threshold) across ALL projects — Tracking is cross-project.
function navBadgeCounts() {
  const counts = {};
  const quiet = allTrackedItems().filter(x => itemNeedsComment(x.story)).length;
  if (quiet) counts.stories = quiet;
  return counts;
}

function renderNavBadges() {
  const counts = navBadgeCounts();
  navButtons.forEach(btn => {
    const badge = btn.querySelector('.nav-badge');
    if (!badge) return;
    const n = counts[btn.dataset.tab];
    if (n) {
      badge.textContent = n;
      badge.title = `${n} tracked item${n === 1 ? '' : 's'} gone quiet — no recent comment`;
      badge.classList.add('show');
    } else {
      badge.textContent = '';
      badge.removeAttribute('title');
      badge.classList.remove('show');
    }
  });
}

function updateHeader() {
  const meta = SCREEN_META[currentTab] || { title: '', scope: '' };
  mainTitle.textContent = meta.title;
  mainSubtitle.textContent = meta.scope;
}

async function selectProject(name) {
  if (!name) return;
  if (selectedProject !== name) {
    teamsAssigneeFilter = 'all';
    teamsStatusFilter = 'all';
    teamsSprintFilter = 'all';
    teamsSearch = '';
  }
  selectedProject = name;
  editingProjectDesc = false;
  renderProjectSelector();
  renderPanels();
  renderNavBadges();
}

async function addProject() {
  const nameEl = document.getElementById('new-project-name');
  const name = nameEl ? nameEl.value.trim() : '';
  if (!name) { alert('Enter a project name.'); return; }
  const descEl = document.getElementById('new-project-description');
  const description = descEl ? descEl.value.trim() : '';

  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  });

  if (!response.ok) {
    const error = await response.json();
    alert(error.error || 'Unable to create project');
    return;
  }

  showNewProjectForm = false;
  selectedProject = name;
  await fetchProjects();
}

async function deleteProject(name) {
  if (!confirm(`Delete project "${name}" and all its data (stories, timeline, transcripts)? This cannot be undone.`)) return;
  const response = await fetch(`/api/project?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!response.ok) {
    alert('Unable to delete project.');
    return;
  }
  if (selectedProject === name) selectedProject = null;
  await refreshProject();
}

function manageToggleNewProjectForm() {
  showNewProjectForm = !showNewProjectForm;
  renderPanels();
  if (showNewProjectForm) {
    setTimeout(() => {
      const el = document.getElementById('new-project-name');
      if (el) el.focus();
    }, 0);
  }
}

async function deleteUpdate(project, storyId, updateId) {
  if (!confirm('Delete this extracted update?')) return;
  const response = await saveRequest(`/api/project/story/update?project=${encodeURIComponent(project)}&storyId=${encodeURIComponent(storyId)}&updateId=${encodeURIComponent(updateId)}`, { method: 'DELETE' });
  if (!response) return;
  await refreshProject();
}

function renderMilestonesPanel(project) {
  const milestones = (project.timeline || []).slice().sort((a, b) => {
    return milestoneHealth(b).score - milestoneHealth(a).score || new Date(a.date || '9999-12-31') - new Date(b.date || '9999-12-31');
  });
  const overdue = milestones.filter(m => milestoneHealth(m).label === 'Overdue').length;
  const dueSoon = milestones.filter(m => milestoneHealth(m).label === 'Due soon').length;
  const noDate = milestones.filter(m => milestoneHealth(m).label === 'No date').length;
  const linked = milestones.filter(m => project.stories.some(story => story.timelineId === m.id)).length;

  const rows = milestones.length ? `
    <ul class="panel-list">
      ${milestones.map(m => {
        const linkedStories = project.stories.filter(story => story.timelineId === m.id);
        const health = milestoneHealth(m);
        return `
          <li class="card milestone-row">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">
              <div style="flex:1;min-width:240px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
                  <h4 style="margin:0;">${escapeHtml(m.title)}</h4>
                  ${m.status ? statusBadge(m.status) : ''}
                  <span class="badge ${health.badge}">${health.label}</span>
                </div>
                <p>${escapeHtml(m.notes || 'No notes yet.')}</p>
                <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                  <span class="micro">${escapeHtml(m.date || 'No date')}</span>
                  <span class="micro">${linkedStories.length} linked work item${linkedStories.length === 1 ? '' : 's'}</span>
                </div>
                ${linkedStories.length ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${linkedStories.slice(0, 5).map(s => `<span class="tag">${escapeHtml(s.summary)}</span>`).join('')}</div>` : ''}
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="button button-small secondary" onclick="startStoryFromTimeline(${eventArg(m.id)})">Create work item</button>
                <button class="button button-small secondary" onclick="toggleLinkStoryForm(${eventArg(m.id)})">Link work item</button>
                <button class="button button-small danger" onclick="deleteItem(${eventArg(selectedProject)}, ${eventArg('timeline')}, ${eventArg(m.id)})">Delete</button>
              </div>
            </div>
            <div id="link-form-${escapeHtml(m.id)}" class="link-form hidden" style="margin-top:12px;">
              <div class="form-row"><label>Select work item</label>
                <select id="timeline-story-select-${escapeHtml(m.id)}">
                  <option value="">Choose a work item</option>
                  ${project.stories.map(story => `<option value="${escapeHtml(story.id)}">${escapeHtml(story.summary)}</option>`).join('')}
                </select>
              </div>
              <button class="button" onclick="submitLinkStory(${eventArg(m.id)})">Link work item</button>
            </div>
          </li>`;
      }).join('')}
    </ul>
  ` : '<div class="card"><p>No milestones yet. Add project checkpoints, dates, and delivery markers here.</p></div>';

  return `
    <div class="card hero-card screen-lead milestones-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Schedule control workspace</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Milestones and delivery dates</h3>
          <p style="margin:0;">Use this page to anchor the queue to real dates. Milestones matter most when they are dated, linked to work items, and detailed enough to hold up in a readout.</p>
        </div>
      </div>
    </div>
    ${renderWorkTabs('timeline')}
    <div class="insight-strip operating-metrics milestones-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Overdue</div>
        <div class="insight-number">${overdue}</div>
        <div class="insight-copy">Milestones that already passed without completion</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Due Soon</div>
        <div class="insight-number">${dueSoon}</div>
        <div class="insight-copy">Milestones due within the next 7 days</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Undated</div>
        <div class="insight-number">${noDate}</div>
        <div class="insight-copy">Milestones that still need dates</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Linked Coverage</div>
        <div class="insight-number">${linked}</div>
        <div class="insight-copy">${milestones.length ? `${linked} of ${milestones.length} milestones connected to work items` : 'No milestones yet'}</div>
      </div>
    </div>
    <div class="section-grid" style="margin-bottom:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Add Milestone</h4>
          <span class="micro">project checkpoint</span>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>Project</label>
            <select id="timeline-project-select">
              ${Object.keys(projects).map(name => `<option value="${escapeHtml(name)}" ${selectedProject === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row"><label>Title</label><input id="timeline-title" /></div>
          <div class="field-row">
            <div><label>Date</label><input id="timeline-date" type="date" /></div>
            <div><label>Status</label><input id="timeline-status" /></div>
          </div>
          <div class="form-row"><label>Notes</label><textarea id="timeline-notes"></textarea></div>
          <button class="button" onclick="createTimeline()">Add Milestone</button>
        </div>
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Milestone Risk View</h4>
          <span class="micro">date pressure and linkage</span>
        </div>
        <p>Milestones are sorted by risk first so overdue and near-term dates rise to the top. Linking work items turns this screen into a delivery map instead of a passive date list.</p>
        <div class="note warn" style="margin-top:14px;">A milestone without a date or linked work items becomes harder to use in grounded status reporting.</div>
      </div>
    </div>
    ${rows}
  `;
}

function renderPanels() {
  if (!selectedProject) {
    overviewPanel.innerHTML = '<p>Select a project or add one to open its control center.</p>';
    portfolioPanel.innerHTML = renderPortfolioPanel();
    storiesPanel.innerHTML = '<p>Select a project to manage work items.</p>';
    trackingPanel.innerHTML = renderTrackingPanel();
    timelinePanel.innerHTML = '<p>Select a project to manage milestones.</p>';
    transcriptsPanel.innerHTML = '<p>Select a project to capture transcripts and updates.</p>';
    reportsPanel.innerHTML = '<p>Select a project to draft a grounded status summary.</p>';
    teamsPanel.innerHTML = '<p>Select a project to draft a grounded Teams update.</p>';
    managePanel.innerHTML = renderManagePanel();
    helpPanel.innerHTML = renderHelpPanel(true);
    return;
  }

  const project = projects[selectedProject];
  overviewPanel.innerHTML = renderDashboard(project);
  portfolioPanel.innerHTML = renderPortfolioPanel();
  trackingPanel.innerHTML = renderTrackingPanel();
  storiesPanel.innerHTML = renderStoriesPanel(project);
  timelinePanel.innerHTML = renderMilestonesPanel(project);

  transcriptsPanel.innerHTML = renderTranscriptsPanel(project);

  reportsPanel.innerHTML = renderReportsPanel();
  teamsPanel.innerHTML = renderTeamsPanel(project);
  managePanel.innerHTML = renderManagePanel();
  helpPanel.innerHTML = renderHelpPanel(false);
}

function renderHelpPanel(needsProject) {
  const aiMode = aiProvider ? `${aiProvider} is configured` : 'No AI provider is configured';
  return `
    <div class="card hero-card screen-lead help-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">How this workspace works</div>
      <h3 style="margin:0 0 8px;">A factual delivery operating system</h3>
      <p style="margin:0;">The app keeps delivery evidence, work-item context, and communication drafts together. It helps you prepare and prioritize; it does not send Jira or Teams updates on your behalf.</p>
    </div>
    ${needsProject ? `<div class="note warn" style="margin-bottom:14px;">Start by creating a project in Settings. Then add work items, capture a DSU or meeting note, and return to Today for the daily queue.</div>` : ''}
    <div class="help-grid">
      <section class="card help-section">
        <div class="section-heading"><h4>Daily flow</h4><span class="micro">use this order</span></div>
        <ol class="help-list">
          <li><strong>Today:</strong> review the blocked, follow-up, and quiet-thread signals.</li>
          <li><strong>Work:</strong> confirm ownership, sprint, Jira comment, and milestone linkage on the items needing action.</li>
          <li><strong>Capture:</strong> save a factual meeting note or DSU when new evidence appears.</li>
          <li><strong>Communicate:</strong> generate a summary or Teams draft only after the evidence looks supportable.</li>
        </ol>
      </section>
      <section class="card help-section">
        <div class="section-heading"><h4>Navigation</h4><span class="micro">five destinations</span></div>
        <ul class="help-list">
          <li><strong>Today</strong> is the selected project's immediate attention view. Use Portfolio here for the all-project rollup.</li>
          <li><strong>Work</strong> contains work items, the cross-project Follow-Up queue, and milestones.</li>
          <li><strong>Capture</strong> stores structured notes and up to five uploaded sources at once; each source keeps its own type.</li>
          <li><strong>Communicate</strong> contains the status summary and Teams draft.</li>
          <li><strong>Settings</strong> manages projects, workspace rules, records, exports, and advanced prompt controls.</li>
        </ul>
      </section>
    </div>
    <div class="help-grid">
      <section class="card help-section">
        <div class="section-heading"><h4>Why work is flagged</h4><span class="micro">operating rules</span></div>
        <ul class="help-list">
          <li><strong>Blocked</strong> comes from a work item's status label and rises first in queues.</li>
          <li><strong>Needs follow-up</strong> means a tracked, open item has not been marked as contacted.</li>
          <li><strong>Quiet thread</strong> means an open tracked item has no recorded Jira comment within the configured freshness window.</li>
          <li><strong>Coverage gaps</strong> flag missing assignee, sprint, comment/note, or milestone context. They are evidence gaps, not proof that delivery is failing.</li>
          <li><strong>Delivery progress</strong> is a weighted planning signal: done work counts fully, active/in-progress work counts halfway.</li>
        </ul>
      </section>
      <section class="card help-section">
        <div class="section-heading"><h4>Evidence flow</h4><span class="micro">what feeds what</span></div>
        <ol class="help-list">
          <li>A structured meeting note is stored as local evidence. It does not change work-item status on its own.</li>
          <li>A source saved as <strong>DSU</strong> can be matched to work items and create extracted updates.</li>
          <li>Extracted updates feed Today, work-item context, status summaries, and Teams drafts.</li>
          <li>Delete a source and its derived extracted updates are removed too, so the evidence trail stays honest.</li>
        </ol>
      </section>
    </div>
    <div class="help-grid">
      <section class="card help-section">
        <div class="section-heading"><h4>AI and review</h4><span class="micro">optional assistance</span></div>
        <p><strong>${escapeHtml(aiMode)}.</strong> AI is used only for DSU extraction, status-summary drafting, and Teams drafting. If an AI call is unavailable, the app uses a heuristic or template fallback.</p>
        <p>Always review generated text and the source badge before copying it. AI never silently changes a Jira work item, sends a Teams message, or becomes the source of truth.</p>
      </section>
      <section class="card help-section">
        <div class="section-heading"><h4>Local data and privacy</h4><span class="micro">what leaves this machine</span></div>
        <p>Projects, work items, milestones, meeting notes, and uploads are stored locally in this workspace. The app is bound to your computer's loopback address and is not shared on the network.</p>
        <p>Only when you explicitly generate an AI-assisted extraction or draft, the relevant project text is sent to the configured AI provider. Without a configured provider, no project text is sent externally.</p>
      </section>
    </div>
    <div class="card help-section help-templates-card">
      <div class="section-heading"><h4>Templates and records</h4><span class="micro">consistency without extra process</span></div>
      <p>Start new work items from the Delivery, Requirement, or Defect/Blocker template to prefill useful acceptance criteria. Templates are starting points, not generated facts: review and adapt them before saving.</p>
      <p>Use <strong>Import CSV</strong> in Work to preview a Jira export before adding it. Existing and repeated Jira keys are skipped, and imported items are not tracked for follow-up until you choose to track them.</p>
      <p><strong>Workspace Data</strong> in Settings is a local records browser. It lets you filter, edit, delete, and export saved work items, milestones, transcripts, and meeting notes. It does not connect to Jira or send data anywhere.</p>
    </div>
  `;
}

function getManageItems() {
  const projectNames = Object.keys(projects);
  const allItems = [];

  projectNames.forEach(name => {
    const project = projects[name];
    if (!project) return;

    if (!manageTypeFilter || manageTypeFilter === 'story') {
      project.stories.forEach(story => {
        allItems.push({
          type: 'Story',
          project: name,
          id: story.id,
          title: story.summary,
          details: story.description || story.notes || '',
          meta: story.labels && story.labels.length ? story.labels.join(', ') : 'No labels',
          linked: story.timelineId ? (project.timeline.find(t => t.id === story.timelineId) || { title: 'Unknown' }).title : '',
          date: story.createdAt || '',
          raw: story
        });
      });
    }

    if (!manageTypeFilter || manageTypeFilter === 'timeline') {
      project.timeline.forEach(entry => {
        allItems.push({
          type: 'Timeline',
          project: name,
          id: entry.id,
          title: entry.title,
          details: entry.notes || '',
          meta: entry.status || 'No status',
          linked: project.stories.filter(s => s.timelineId === entry.id).map(s => s.summary).join(', '),
          date: entry.date || '',
          raw: entry
        });
      });
    }

    if (!manageTypeFilter || manageTypeFilter === 'transcript') {
      project.transcripts.forEach(transcript => {
        allItems.push({
          type: 'Transcript',
          project: name,
          id: transcript.id,
          title: transcript.title,
          details: transcript.notes || '',
          meta: transcript.type || 'No type',
          linked: '',
          date: transcript.date || transcript.uploadedAt || '',
          raw: transcript
        });
      });
    }

  });

  let filtered = allItems;
  if (manageProjectFilter) {
    filtered = filtered.filter(item => item.project === manageProjectFilter);
  }

  if (manageSearch.trim()) {
    const search = manageSearch.trim().toLowerCase();
    filtered = filtered.filter(item => {
      return [item.title, item.details, item.meta, item.project, item.linked]
        .some(value => value && value.toLowerCase().includes(search));
    });
  }

  const direction = manageSortDirection === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    if (manageSortKey === 'date') {
      const aDate = a.date ? new Date(a.date).getTime() : 0;
      const bDate = b.date ? new Date(b.date).getTime() : 0;
      return (aDate - bDate) * direction;
    }
    if (manageSortKey === 'type') {
      return a.type.localeCompare(b.type) * direction;
    }
    if (manageSortKey === 'project') {
      return a.project.localeCompare(b.project) * direction;
    }
    return 0;
  });

  return filtered;
}

// Client-side mirror of the server's inferStoryStatus (kept in sync with server.js).
function inferStatusClient(story) {
  const labels = Array.isArray(story.labels) ? story.labels.join(' ').toLowerCase() : String(story.labels || '').toLowerCase();
  if (/(done|complete|completed)/.test(labels)) return 'Done';
  if (/(in progress|in-progress|ongoing)/.test(labels)) return 'In progress';
  if (/(blocked|on hold)/.test(labels)) return 'Blocked';
  if (labels.includes('active')) return 'Active';
  if (/(planned|to do|todo|backlog)/.test(labels)) return 'Planned';
  if (story.updates && story.updates.length) return 'Active';
  if (story.timelineId) return 'Planned';
  return 'Not started';
}

function storyAssignee(story) {
  return String((story && (story.assignee || story.owner)) || '').trim();
}

function storySprint(story) {
  return String((story && story.sprint) || '').trim();
}

function storyLastCommentText(story) {
  return String((story && (story.lastComment || story.lastUpdate)) || '').trim();
}

function previewText(text, max = 120) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function sprintOptions() {
  const configured = Array.isArray(settings.sprintOptions) ? settings.sprintOptions : [];
  const inferred = [];
  Object.values(projects).forEach(project => {
    (project.stories || []).forEach(story => {
      const value = storySprint(story);
      if (value) inferred.push(value);
    });
  });
  return [...new Set(configured.concat(inferred).map(value => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sprintSelectHtml(prefix, currentValue, extraAttrs = '') {
  const current = String(currentValue || '').trim();
  const options = sprintOptions();
  const values = current && !options.includes(current) ? [current, ...options] : options;
  return `
    <select id="${prefix}-sprint" ${extraAttrs}>
      <option value="">No sprint selected</option>
      ${values.map(value => `<option value="${escapeHtml(value)}" ${current === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
    </select>
    <div class="micro" style="margin-top:6px;text-transform:none;">Controlled from Settings → Sprint catalog.</div>`;
}

// --- Unified item tracking / "comment gone quiet" logic ---
// Stories and tickets are now one type: a Story that is `tracked` is the follow-up item.
// "Closed" is unified onto the inferred status: an item is closed when its status is Done.
function itemIsClosed(story) { return inferStatusClient(story) === 'Done'; }

// Whole days since an ISO timestamp; null/blank → null ("never").
function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

// A tracked item "needs follow-up" when open (not Done) and its owner hasn't been contacted.
function itemNeedsFollowup(s) { return !!s.tracked && !itemIsClosed(s) && !s.contacted; }

// A tracked item "needs a comment nudge" when it's open AND its last comment is missing
// (never) or older than the configured staleness threshold. Only tracked items count.
function itemNeedsComment(s) {
  if (!s.tracked || itemIsClosed(s)) return false;
  const d = daysSince(s.lastCommentedAt);
  return d === null || d >= (settings.commentStaleDays || 7);
}

// Every tracked item across all projects → { project, story }. Tracking is cross-project.
function allTrackedItems() {
  const out = [];
  for (const name of Object.keys(projects)) {
    (projects[name].stories || []).forEach(s => { if (s.tracked) out.push({ project: name, story: s }); });
  }
  return out;
}

// Human-friendly last-comment age, e.g. "today", "3d ago", "never".
function lastCommentLabel(t) {
  const d = daysSince(t.lastCommentedAt);
  if (d === null) return 'never';
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const target = new Date(dateValue);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

function milestoneIsClosed(entry) {
  return /done|complete|completed|closed/i.test(String(entry?.status || ''));
}

function milestoneHealth(entry) {
  const until = daysUntil(entry?.date);
  if (until === null) return { label: 'No date', badge: 'notstarted', score: 1 };
  if (milestoneIsClosed(entry)) return { label: 'Complete', badge: 'done', score: 0 };
  if (until < 0) return { label: 'Overdue', badge: 'blocked', score: 4 };
  if (until <= 7) return { label: 'Due soon', badge: 'followup', score: 3 };
  if (until <= 21) return { label: 'Upcoming', badge: 'planned', score: 2 };
  return { label: 'On horizon', badge: 'count', score: 1 };
}

function statusPriority(item) {
  return (
    (inferStatusClient(item) === 'Blocked' ? 5 : 0) +
    (itemNeedsFollowup(item) ? 4 : 0) +
    (itemNeedsComment(item) ? 3 : 0) +
    (item.tracked ? 1 : 0)
  );
}

function latestStoryActivityTime(story) {
  const candidates = [
    story?.createdAt,
    story?.lastCommentedAt,
    ...(story?.updates || []).map(update => update.date)
  ].map(value => new Date(value || 0).getTime()).filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

function latestStoryActivityLabel(story) {
  const time = latestStoryActivityTime(story);
  return time ? new Date(time).toLocaleDateString() : 'No dated activity';
}

function workItemAttentionProfile(story, project) {
  const linkedMilestone = project.timeline.find(entry => entry.id === story.timelineId);
  if (inferStatusClient(story) === 'Done') {
    return { badge: 'done', label: 'Stable', detail: 'Recorded as done' };
  }
  if (inferStatusClient(story) === 'Blocked') {
    return { badge: 'blocked', label: 'Blocked', detail: story.dependencies ? `Blocked by ${story.dependencies}` : (story.notes || 'Blocked work item') };
  }
  if (itemNeedsFollowup(story)) {
    return { badge: 'followup', label: 'Follow-up', detail: storyAssignee(story) ? `Assignee not contacted: ${storyAssignee(story)}` : 'Assignee not contacted' };
  }
  if (itemNeedsComment(story)) {
    return { badge: 'quiet', label: 'Quiet', detail: `No recent Jira comment · ${lastCommentLabel(story)}` };
  }
  if (!storyAssignee(story)) {
    return { badge: 'notstarted', label: 'Assignee gap', detail: 'No assignee recorded' };
  }
  if (!storySprint(story)) {
    return { badge: 'planned', label: 'Sprint gap', detail: 'No sprint recorded' };
  }
  if (!linkedMilestone) {
    return { badge: 'planned', label: 'Linkage gap', detail: 'Not linked to a milestone' };
  }
  if (!storyLastCommentText(story)) {
    return { badge: 'planned', label: 'Comment gap', detail: 'No last comment or PM note recorded' };
  }
  return { badge: 'inprogress', label: 'Active', detail: 'No immediate operating risk recorded' };
}

function openWorkItems(addNew = false) {
  if (!selectedProject) return;
  if (addNew) storyShowAddForm = true;
  activateTab('stories');
  storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
  if (addNew) {
    setTimeout(() => document.getElementById('story-summary')?.focus(), 40);
  }
}

function openMilestones() {
  activateTab('timeline');
}

function openFollowUp() {
  activateTab('tracking');
}

function openCapture(mode = '') {
  captureFocus = mode;
  activateTab('transcripts');
  if (mode === 'meeting') {
    setTimeout(() => document.getElementById('meeting-title')?.focus(), 40);
  }
}

function openStatusSummary() {
  activateTab('reports');
}

function openTeamsDraft() {
  activateTab('teams');
}

function openSettings() {
  activateTab('manage');
}

function openPortfolio() {
  activateTab('portfolio');
}

function renderSectionTabs(active, items) {
  return `<div class="section-tabs" role="navigation" aria-label="Workspace section">${items.map(item => `
    <button type="button" class="section-tab ${active === item.tab ? 'active' : ''}" onclick="activateTab('${item.tab}')">${escapeHtml(item.label)}</button>`).join('')}
  </div>`;
}

function renderWorkTabs(active) {
  return renderSectionTabs(active, [
    { tab: 'stories', label: 'Work items' },
    { tab: 'tracking', label: 'Follow-up' },
    { tab: 'timeline', label: 'Milestones' }
  ]);
}

function renderCommunicateTabs(active) {
  return renderSectionTabs(active, [
    { tab: 'reports', label: 'Status summary' },
    { tab: 'teams', label: 'Teams draft' }
  ]);
}

function startEditProjectDesc() {
  editingProjectDesc = true;
  overviewPanel.innerHTML = renderDashboard(projects[selectedProject]);
}

function cancelEditProjectDesc() {
  editingProjectDesc = false;
  overviewPanel.innerHTML = renderDashboard(projects[selectedProject]);
}

async function saveProjectDesc() {
  const el = document.getElementById('edit-project-desc');
  const description = el ? el.value : '';
  const response = await saveRequest('/api/project', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: selectedProject, description })
  });
  if (!response) return;
  editingProjectDesc = false;
  await refreshProject();
}

function renderPortfolioPanel() {
  const names = Object.keys(projects);
  if (!names.length) return '<div class="card"><h4>Portfolio</h4><p>No projects yet. Add one from the sidebar.</p></div>';
  const totalStories = names.reduce((sum, name) => sum + ((projects[name].stories || []).length), 0);
  const totalBlocked = names.reduce((sum, name) => sum + (projects[name].stories || []).filter(s => inferStatusClient(s) === 'Blocked').length, 0);
  const totalTracked = names.reduce((sum, name) => sum + (projects[name].stories || []).filter(s => s.tracked).length, 0);
  const totalQuiet = names.reduce((sum, name) => sum + (projects[name].stories || []).filter(itemNeedsComment).length, 0);

  const cards = names.map(name => {
    const p = projects[name];
    const stories = p.stories || [];
    const tracked = stories.filter(s => s.tracked);
    const counts = {};
    stories.forEach(s => { const st = inferStatusClient(s); counts[st] = (counts[st] || 0) + 1; });
    const blocked = stories.filter(s => inferStatusClient(s) === 'Blocked').length;
    const followups = tracked.filter(itemNeedsFollowup).length;
    const quiet = tracked.filter(itemNeedsComment).length;
    const done = counts['Done'] || 0;
    const partial = (counts['In progress'] || 0) + (counts['Active'] || 0);
    const pct = stories.length ? Math.round(((done + 0.5 * partial) / stories.length) * 100) : 0;
    const barColor = pct >= 80 ? 'var(--st-done)' : 'var(--accent)';
    const healthBadge = blocked ? 'blocked' : (followups || quiet) ? 'followup' : 'done';
    const healthLabel = blocked ? 'At risk' : (followups || quiet) ? 'Needs steering' : 'On track';
    return `
      <div class="card portfolio-card" onclick="selectProject(${escapeHtml(JSON.stringify(name))})" title="Open ${escapeHtml(name)}">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div style="min-width:0;">
            <h4 style="margin:0;">${escapeHtml(name)}</h4>
            <p style="margin:4px 0 0;">${escapeHtml(p.description || 'No description')}</p>
          </div>
          <span class="badge ${healthBadge}">${healthLabel}</span>
        </div>
        <div style="margin-top:14px;">
          <div style="display:flex;justify-content:space-between;" class="micro"><span>delivery progress</span><span>${pct}%</span></div>
          <div class="status-bar" style="margin-top:5px;"><span style="width:${pct}%;background:${barColor};"></span></div>
        </div>
        <div class="triage-field-strip compact" style="margin-top:12px;">
          <div class="triage-field"><span class="micro">Work Items</span><strong>${stories.length}</strong></div>
          <div class="triage-field ${blocked ? 'warn' : ''}"><span class="micro">Blocked</span><strong>${blocked}</strong></div>
          <div class="triage-field ${(followups || quiet) ? 'info' : ''}"><span class="micro">Follow-Up</span><strong>${followups + quiet}</strong></div>
          <div class="triage-field"><span class="micro">Quiet</span><strong>${quiet}</strong></div>
        </div>
      </div>`;
  }).join('');

  const attention = [];
  names.forEach(name => {
    (projects[name].stories || []).filter(s => inferStatusClient(s) === 'Blocked').forEach(s => attention.push({
      badge: 'blocked', label: s.summary, project: name, detail: s.dependencies ? `blocked · ${s.dependencies}` : (s.notes ? `blocked · ${s.notes}` : 'blocked')
    }));
    (projects[name].stories || []).filter(itemNeedsFollowup).forEach(s => attention.push({
      badge: 'followup', label: (s.jiraId ? s.jiraId + ' · ' : '') + (s.summary || ''), project: name, detail: storyAssignee(s) ? `assignee not contacted · ${storyAssignee(s)}` : 'assignee not contacted'
    }));
    (projects[name].stories || []).filter(itemNeedsComment).forEach(s => attention.push({
      badge: 'quiet', label: (s.jiraId ? s.jiraId + ' · ' : '') + (s.summary || ''), project: name, detail: `no comment · ${lastCommentLabel(s)}`
    }));
  });
  const badgeText = { blocked: 'BLOCKED', followup: 'FOLLOW-UP', quiet: 'QUIET' };
  const attentionHtml = attention.length ? attention.map((a, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 0;${i < attention.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <span class="badge ${a.badge}">${badgeText[a.badge]}</span>
        <strong>${escapeHtml(a.label)}</strong>
        <span class="mono" style="color:var(--muted-2);font-size:0.8rem;">${escapeHtml(a.project)}</span>
      </div>
      <span style="color:var(--muted);font-size:0.85rem;text-align:right;">${escapeHtml(a.detail)}</span>
    </div>`).join('') : '<p>Nothing flagged across projects.</p>';

  return `
    <div class="card hero-card screen-lead portfolio-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Portfolio control view</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Cross-project operating picture</h3>
          <p style="margin:0;">Use this view to see which projects need intervention before you drill into a single queue. It favors risk and follow-up pressure over passive progress reporting.</p>
        </div>
      </div>
    </div>
    <div class="insight-strip operating-metrics portfolio-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Projects</div>
        <div class="insight-number">${names.length}</div>
        <div class="insight-copy">${totalStories} work items across the portfolio</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Blocked</div>
        <div class="insight-number">${totalBlocked}</div>
        <div class="insight-copy">Issues already signaling delivery risk</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Tracked</div>
        <div class="insight-number">${totalTracked}</div>
        <div class="insight-copy">Items being actively watched across projects</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Quiet Threads</div>
        <div class="insight-number">${totalQuiet}</div>
        <div class="insight-copy">Follow-up threads that may need a nudge</div>
      </div>
    </div>
    <div class="portfolio-grid">${cards}</div>
    <div class="card portfolio-queue-card">
      <div class="section-heading">
        <h4>Portfolio Queue</h4>
        <span class="micro">what needs attention first</span>
      </div>
      <p style="margin:0 0 8px;">Blocked work items, tracked follow-up needs, and quiet comment threads across every project.</p>
      ${attentionHtml}
    </div>
  `;
}

const STATUS_ORDER = ['Done', 'In progress', 'Active', 'Blocked', 'Planned', 'Not started'];
const STATUS_COLOR = {
  Done: 'var(--st-done)', 'In progress': 'var(--st-inprogress)', Active: 'var(--st-inprogress)',
  Blocked: 'var(--st-blocked)', Planned: 'var(--st-planned)', 'Not started': 'var(--st-notstarted)'
};

function renderDashboard(project) {
  const stories = project.stories || [];
  const timeline = project.timeline || [];
  const transcripts = project.transcripts || [];
  const tracked = stories.filter(s => s.tracked);

  const counts = {};
  stories.forEach(s => { const st = inferStatusClient(s); counts[st] = (counts[st] || 0) + 1; });
  const total = stories.length || 1;
  const doneCount = counts['Done'] || 0;
  const partialCount = (counts['In progress'] || 0) + (counts['Active'] || 0);
  const blockedCount = counts['Blocked'] || 0;
  const pctComplete = stories.length ? Math.round(((doneCount + 0.5 * partialCount) / stories.length) * 100) : 0;

  const updates = [];
  stories.forEach(s => (s.updates || []).forEach(u => updates.push({ story: s.summary, ...u })));
  updates.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const dsuCount = transcripts.filter(t => (t.type || '').toLowerCase() === 'dsu').length;
  const followupCount = tracked.filter(itemNeedsFollowup).length;
  const quietCount = tracked.filter(itemNeedsComment).length;
  const milestoneCount = timeline.length;
  const overdueMilestones = timeline.filter(t => milestoneHealth(t).label === 'Overdue').length;
  const nearMilestones = timeline.filter(t => milestoneHealth(t).label === 'Due soon').length;
  const assigneeGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyAssignee(story)).length;
  const sprintGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storySprint(story)).length;
  const commentGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyLastCommentText(story)).length;
  const readiness = Math.min(100, Math.round(((updates.length * 12) + (milestoneCount * 7) + (doneCount * 10)) / Math.max(1, stories.length * 10) * 10));

  // Segmented status bar + legend
  const present = STATUS_ORDER.filter(st => counts[st]);
  const segBar = present.length
    ? `<div class="status-bar" style="height:22px;">${present.map(st => `<span style="width:${(counts[st] / total) * 100}%;background:${STATUS_COLOR[st]};" title="${st}: ${counts[st]}"></span>`).join('')}</div>`
    : '<p>No work items yet.</p>';
  const legend = present.map(st => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.82rem;"><span style="width:11px;height:11px;border-radius:3px;background:${STATUS_COLOR[st]};"></span>${st} ${counts[st]}</span>`).join('');

  const milestones = timeline
    .slice()
    .sort((a, b) => milestoneHealth(b).score - milestoneHealth(a).score || new Date(a.date || '9999-12-31') - new Date(b.date || '9999-12-31'))
    .slice(0, 5);

  const recentHtml = updates.length ? updates.slice(0, 6).map((u, i) => {
    const src = (u.source || u.transcriptTitle || 'DSU').toString();
    const shortSrc = src.length > 20 ? src.slice(0, 19) + '…' : src;
    return `
    <div style="padding:11px 0;${i < Math.min(updates.length, 6) - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
        <strong>${escapeHtml(u.story)}</strong>
        <span class="src-badge" title="Update source">${escapeHtml(shortSrc)}</span>
      </div>
      <p style="margin:4px 0 6px;">${escapeHtml(u.update || u.excerpt || '')}</p>
      <span class="micro">${escapeHtml(u.date || 'no date')}</span>
    </div>`;
  }).join('') : '<p>No captured updates yet. Upload a DSU or meeting transcript to populate this timeline.</p>';

  const attention = [];
  stories.filter(s => inferStatusClient(s) === 'Blocked').forEach(s => attention.push({
    kind: 'blocked',
    title: s.summary,
    detail: s.dependencies ? `Blocked by ${s.dependencies}` : (s.notes ? s.notes : 'Blocked work item')
  }));
  stories.filter(itemNeedsFollowup).forEach(s => attention.push({
    kind: 'followup',
    title: `${s.jiraId ? `${s.jiraId} · ` : ''}${s.summary}`,
    detail: storyAssignee(s) ? `Assignee not contacted: ${storyAssignee(s)}` : 'Assignee not contacted'
  }));
  stories.filter(itemNeedsComment).forEach(s => attention.push({
    kind: 'quiet',
    title: `${s.jiraId ? `${s.jiraId} · ` : ''}${s.summary}`,
    detail: `No recent Jira comment · ${lastCommentLabel(s)}`
  }));

  const attentionHtml = attention.length
    ? attention.slice(0, 6).map((item, index) => `
      <div style="padding:11px 0;${index < Math.min(attention.length, 6) - 1 ? 'border-bottom:1px solid var(--border);' : ''}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p style="margin:4px 0 0;">${escapeHtml(item.detail)}</p>
          </div>
          <span class="badge ${item.kind === 'blocked' ? 'blocked' : item.kind === 'followup' ? 'followup' : 'quiet'}">${item.kind === 'followup' ? 'FOLLOW-UP' : item.kind.toUpperCase()}</span>
        </div>
      </div>`).join('')
    : '<p>No blockers or stale follow-ups in this project.</p>';

  const milestoneHtml = milestones.length
    ? milestones.map((m, index) => `
      <div class="surface-row">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <strong>${escapeHtml(m.title)}</strong>
            <p style="margin:4px 0 0;">${escapeHtml(m.notes || 'No notes yet.')}</p>
          </div>
          <div style="text-align:right;">
            <div class="micro">${escapeHtml(m.date || 'No date')}</div>
            ${m.status ? statusBadge(m.status) : ''}
            <div style="margin-top:6px;"><span class="badge ${milestoneHealth(m).badge}">${milestoneHealth(m).label}</span></div>
          </div>
        </div>
      </div>`).join('')
    : '<p>No milestones yet. Add project dates and checkpoints here.</p>';

  const focusItems = stories
    .slice()
    .sort((a, b) => {
      const latest = item => new Date((item.updates || [])[0]?.date || item.createdAt || 0).getTime();
      return statusPriority(b) - statusPriority(a) || latest(b) - latest(a);
    })
    .slice(0, 6);

  const focusHtml = focusItems.length
    ? focusItems.map((story, index) => `
      <div class="home-queue-card${index < focusItems.length - 1 ? ' with-divider' : ''}">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div style="min-width:0;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              ${story.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.78rem;">${escapeHtml(story.jiraId)}</span>` : ''}
              <strong>${escapeHtml(story.summary)}</strong>
              ${story.tracked ? '<span class="badge count">FOLLOW-UP</span>' : ''}
              ${statusBadge(inferStatusClient(story))}
            </div>
            <div class="triage-field-strip compact" style="margin-top:10px;">
              <div class="triage-field ${storyAssignee(story) ? '' : 'warn'}"><span class="micro">Assignee</span><strong>${escapeHtml(storyAssignee(story) || 'Unassigned')}</strong></div>
              <div class="triage-field ${storySprint(story) ? '' : 'warn'}"><span class="micro">Sprint</span><strong>${escapeHtml(storySprint(story) || 'Not set')}</strong></div>
              <div class="triage-field ${storyLastCommentText(story) ? '' : 'info'}"><span class="micro">Comment Date</span><strong>${escapeHtml(lastCommentLabel(story))}</strong></div>
              <div class="triage-field ${story.tracked ? '' : 'muted'}"><span class="micro">Follow-Up</span><strong>${story.tracked ? 'Tracked' : 'Optional'}</strong></div>
            </div>
            <p style="margin:10px 0 0;">${escapeHtml(previewText(storyLastCommentText(story) || story.notes || story.description || 'No notes yet.', 180))}</p>
          </div>
        </div>
      </div>`).join('')
    : '<p>No work items yet. Add the first Jira-backed work item to start using this project as your operating console.</p>';

  const todayQueueHtml = focusItems.length
    ? focusItems.slice(0, 3).map(story => `
      <div class="today-row">
        <div style="min-width:0;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${story.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.76rem;">${escapeHtml(story.jiraId)}</span>` : ''}
            <strong>${escapeHtml(story.summary)}</strong>
            ${statusBadge(inferStatusClient(story))}
          </div>
          <div class="micro" style="margin-top:6px;text-transform:none;">${storyAssignee(story) ? `assignee ${escapeHtml(storyAssignee(story))} · ` : ''}${storySprint(story) ? `sprint ${escapeHtml(storySprint(story))} · ` : ''}comment ${escapeHtml(lastCommentLabel(story))}</div>
        </div>
        <span class="badge ${workItemAttentionProfile(story, project).badge}">${escapeHtml(workItemAttentionProfile(story, project).label)}</span>
      </div>`).join('')
    : '<p>No work items are queued yet.</p>';

  const descRow = editingProjectDesc ? `
    <textarea id="edit-project-desc" style="width:100%;min-height:52px;">${escapeHtml(project.description || '')}</textarea>
    <div style="margin-top:6px;display:flex;gap:8px;">
      <button class="button button-small" onclick="saveProjectDesc()">Save</button>
      <button class="button button-small secondary" onclick="cancelEditProjectDesc()">Cancel</button>
    </div>` : `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="color:var(--muted);">${escapeHtml(project.description || 'No description provided.')}</span>
      <button class="button button-small secondary" onclick="startEditProjectDesc()">Edit</button>
    </div>`;

  const topRiskSummary = attention.length
    ? `${attention.length} active project signal${attention.length === 1 ? '' : 's'}`
    : 'No immediate delivery signals';
  const nextPriority = attention[0] || (milestones[0] ? {
    kind: milestoneHealth(milestones[0]).badge,
    title: milestones[0].title,
    detail: `${milestoneHealth(milestones[0]).label}${milestones[0].date ? ` · ${milestones[0].date}` : ''}`
  } : null);
  const todayStamp = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const priorityTone = nextPriority?.kind === 'blocked' ? 'blocked' : nextPriority?.kind === 'followup' ? 'followup' : nextPriority?.kind === 'quiet' ? 'quiet' : 'planned';
  const priorityLabel = nextPriority?.kind === 'blocked' ? 'What needs you now · blocked'
    : nextPriority?.kind === 'followup' ? 'What needs you now · follow-up'
    : nextPriority?.kind === 'quiet' ? 'What needs you now · quiet thread'
    : 'What needs you now';

  return `
    <div class="dashboard-topline">
      <div>
        <div class="dashboard-project-line">${escapeHtml(selectedProject)} · example project</div>
        <h3 class="dashboard-screen-title">Today</h3>
        <div class="dashboard-screen-subtitle">What needs your attention today — ${escapeHtml(todayStamp)}</div>
      </div>
      <div class="hero-actions">
        <button class="button" onclick="openStatusSummary()">Open status summary</button>
        <button class="button secondary" onclick="openCapture()">Capture evidence</button>
        <button class="button secondary" onclick="openPortfolio()">Portfolio</button>
      </div>
    </div>
    <div class="attention-banner ${priorityTone}" style="margin-bottom:18px;">
      <div class="attention-banner-head">
        <div class="attention-banner-kicker">${priorityLabel}</div>
        <span class="attention-banner-count">${attention.length ? `${attention.length} active signal${attention.length === 1 ? '' : 's'}` : 'No critical items'}</span>
      </div>
      <div class="attention-banner-body">
        ${nextPriority ? `
          <div class="attention-banner-id-row">
            ${nextPriority.title.includes('·') ? `<span class="mono">${escapeHtml(nextPriority.title.split('·')[0].trim())}</span>` : ''}
            <span class="badge ${priorityTone}">${priorityTone === 'blocked' ? 'Blocked' : priorityTone === 'followup' ? 'Follow-up' : priorityTone === 'quiet' ? 'Quiet' : 'Next'}</span>
          </div>
          <h4>${escapeHtml(nextPriority.title)}</h4>
          <p>${escapeHtml(nextPriority.detail)}</p>` : '<p>No immediate blockers or stale signals are recorded.</p>'}
      </div>
    </div>
    <div class="priority-banner" style="margin-bottom:16px;">
      <div class="priority-panel">
        <div>
          <div class="micro" style="margin-bottom:8px;">Project workspace</div>
          <h3 style="margin:0 0 8px;font-size:1.7rem;letter-spacing:-0.03em;">${escapeHtml(selectedProject)}</h3>
          ${descRow}
        </div>
        <div class="priority-frame">
          <div class="today-queue">
            <div class="micro" style="margin-bottom:8px;">Today&apos;s queue</div>
            ${todayQueueHtml}
          </div>
          <div style="margin-top:12px;" class="hero-actions">
            <button class="button" onclick="openWorkItems()">Review queue</button>
            <button class="button secondary" onclick="openStatusSummary()">Draft summary</button>
            <button class="button secondary" onclick="openCapture()">Capture update</button>
          </div>
        </div>
      </div>
      <div class="priority-panel">
        <div class="priority-frame">
          <div class="micro" style="margin-bottom:8px;">Delivery signal</div>
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px;">
            <div>
              <div style="font-size:2rem;font-weight:700;line-height:1;letter-spacing:-0.04em;">${pctComplete}%</div>
              <div class="micro" style="text-transform:none;margin-top:6px;">${doneCount} done · ${partialCount} active · ${blockedCount} blocked</div>
            </div>
            <span class="badge ${blockedCount ? 'blocked' : pctComplete >= 70 ? 'done' : 'inprogress'}">${blockedCount ? 'At risk' : pctComplete >= 70 ? 'On track' : 'In motion'}</span>
          </div>
          ${segBar}
          <div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap;">${legend}</div>
        </div>
        <div class="priority-frame">
          <div class="micro" style="margin-bottom:8px;">Draft readiness</div>
          <div style="font-size:1.55rem;font-weight:700;line-height:1;letter-spacing:-0.03em;">${readiness}%</div>
          <p style="margin-top:8px;">${updates.length} captured update${updates.length === 1 ? '' : 's'} · ${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'} · ${dsuCount} DSU source${dsuCount === 1 ? '' : 's'}</p>
        </div>
      </div>
    </div>
    <div class="signal-grid">
      <div class="signal-card">
        <div class="micro">Blocked Work</div>
        <div class="signal-value">${blockedCount}</div>
        <p>Work items currently blocked and likely to slip without action.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Follow-Up Risk</div>
        <div class="signal-value">${followupCount + quietCount}</div>
        <p>${followupCount} need contact · ${quietCount} quiet Jira threads.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Evidence Gaps</div>
        <div class="signal-value">${assigneeGapCount + sprintGapCount + commentGapCount}</div>
        <p>${assigneeGapCount} assignee gaps · ${sprintGapCount} sprint gaps · ${commentGapCount} comment gaps.</p>
      </div>
    </div>
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Milestone Outlook</h4>
          <span class="micro">schedule and pressure</span>
        </div>
        <p style="margin:0 0 10px;">Upcoming dates and milestone notes, with pressure surfaced before they surprise the queue.</p>
        <div class="micro" style="margin-bottom:8px;">Upcoming milestones</div>
        ${milestoneHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Attention Now</h4>
          <span class="micro">current risk signals</span>
        </div>
        <p style="margin:0 0 8px;">${escapeHtml(topRiskSummary)} across blocked work, follow-up needs, and quiet Jira threads.</p>
        ${attentionHtml}
      </div>
    </div>
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Operating Queue</h4>
          <span class="micro">highest operational importance</span>
        </div>
        <p style="margin:0 0 8px;">These are the items most likely to shape your day, using the same field language as the queue pages.</p>
        ${focusHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Recent Changes</h4>
          <span class="micro">captured updates</span>
        </div>
        <p style="margin:0 0 8px;">The freshest recorded DSU and meeting evidence available for follow-up and reporting.</p>
        ${recentHtml}
      </div>
    </div>
    <div class="card" style="margin-top:14px;">
      <div class="micro" style="margin-bottom:8px;">Outputs</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="button" onclick="openStatusSummary()">Open status summary</button>
        <button class="button secondary" onclick="openTeamsDraft()">Open Teams draft</button>
        <button class="button secondary" onclick="openSettings()">AI and workspace settings</button>
        <span class="micro">${updates.length} captured updates · ${dsuCount} DSU transcript${dsuCount === 1 ? '' : 's'} available for grounded drafting</span>
      </div>
    </div>
  `;
}

function teamsOwnersOf(project) {
  const stories = (project && project.stories) || [];
  return [...new Set(stories.map(s => storyAssignee(s)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function filteredTeamsStories(project) {
  const search = teamsSearch.trim().toLowerCase();
  return ((project && project.stories) || []).filter(story => {
    if (teamsAssigneeFilter !== 'all' && storyAssignee(story) !== teamsAssigneeFilter) return false;
    if (teamsStatusFilter !== 'all' && inferStatusClient(story) !== teamsStatusFilter) return false;
    if (teamsSprintFilter !== 'all' && storySprint(story) !== teamsSprintFilter) return false;
    if (!search) return true;
    return [story.jiraId, story.summary, storyAssignee(story), storySprint(story), inferStatusClient(story), storyLastCommentText(story)]
      .some(value => String(value || '').toLowerCase().includes(search));
  });
}

function renderTeamsPanel(project) {
  const stories = (project && project.stories) || [];
  const visibleStories = filteredTeamsStories(project);
  const owners = teamsOwnersOf(project);
  const sprintOptions = [...new Set(stories.map(story => storySprint(story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const selCount = teamsSelectedStories.size;
  const trackedCount = stories.filter(s => s.tracked).length;
  const blockedCount = stories.filter(s => inferStatusClient(s) === 'Blocked').length;

  const ownerChips = owners.map((o, i) => {
    const owned = stories.filter(s => storyAssignee(s) === o);
    const active = teamsAssigneeFilter === o;
    return `<button type="button" class="button button-small ${active ? '' : 'secondary'}" style="${active ? 'background:var(--success);border-color:var(--success);color:#fff;' : ''}" onclick="setTeamsAssigneeFilter(${i})">${escapeHtml(o)} (${owned.length})</button>`;
  }).join(' ');

  const itemRows = visibleStories.length ? visibleStories.map(s => `
    <label class="check-row">
      <input type="checkbox" ${teamsSelectedStories.has(s.id) ? 'checked' : ''} onchange="toggleTeamsStory(${eventArg(s.id)})" />
      <span>${s.jiraId ? `<strong class="mono" style="color:var(--accent);">${escapeHtml(s.jiraId)}</strong> ` : ''}${escapeHtml(s.summary)} <small style="color:var(--muted);">(${escapeHtml(inferStatusClient(s))}${storyAssignee(s) ? ' · ' + escapeHtml(storyAssignee(s)) : ''}${storySprint(s) ? ' · ' + escapeHtml(storySprint(s)) : ''})</small>${s.tracked ? ' <span class="badge count" style="font-size:0.6rem;">TRACKED</span>' : ''}</span>
    </label>`).join('') : '<small>No work items match the current filters.</small>';

  return `
    <div class="card hero-card screen-lead teams-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Leadership-ready message draft</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Teams draft workspace</h3>
          <p style="margin:0;">Build a message from selected work items, then edit it before sending. This screen is meant to turn operational detail into a clean stakeholder update without losing grounding.</p>
        </div>
      </div>
    </div>
    ${renderCommunicateTabs('teams')}
    <div class="insight-strip operating-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Selected</div>
        <div class="insight-number">${selCount}</div>
        <div class="insight-copy">Items currently included in the message</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Assignees</div>
        <div class="insight-number">${owners.length}</div>
        <div class="insight-copy">Unique assignees represented in this project</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Tracked</div>
        <div class="insight-number">${trackedCount}</div>
        <div class="insight-copy">Items already being watched in follow-up</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Blocked</div>
        <div class="insight-number">${blockedCount}</div>
        <div class="insight-copy">Items likely to shape the narrative most</div>
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="section-heading">
          <h4>Compose</h4>
          <span class="micro">pick the story set</span>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>Recipient</label><input value="${escapeHtml(teamsRecipient)}" placeholder="Ana" oninput="setTeamsField('recipient', this.value)" /></div>
          <div class="form-row"><label>Subject / board (optional)</label><input value="${escapeHtml(teamsSubject)}" placeholder="D&amp;A Intake &amp; Triage Board" oninput="setTeamsField('subject', this.value)" /></div>
        </div>
        <div class="teams-filter-row">
          <select onchange="setTeamsFilter('status', this.value)">
            <option value="all" ${teamsStatusFilter === 'all' ? 'selected' : ''}>All statuses</option>
            ${['Blocked', 'In progress', 'Active', 'Planned', 'Done', 'Not started'].map(status => `<option value="${status}" ${teamsStatusFilter === status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
          <select onchange="setTeamsFilter('sprint', this.value)">
            <option value="all" ${teamsSprintFilter === 'all' ? 'selected' : ''}>All sprints</option>
            ${sprintOptions.map(sprint => `<option value="${escapeHtml(sprint)}" ${teamsSprintFilter === sprint ? 'selected' : ''}>${escapeHtml(sprint)}</option>`).join('')}
          </select>
          <input id="teams-search" value="${escapeHtml(teamsSearch)}" placeholder="Search Jira or story" oninput="setTeamsFilter('search', this.value)" />
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:12px 0 4px;">
          ${ownerChips}
          <button class="button button-small secondary" onclick="setTeamsFilter('assignee', 'all')">All assignees</button>
          <button class="button button-small secondary" onclick="selectAllTeams()">Select shown</button>
          <button class="button button-small secondary" onclick="clearTeamsSelection()">Clear</button>
          <span class="micro">${selCount} selected</span>
        </div>
        <div class="micro" style="margin:12px 0 6px;">Work items · ${visibleStories.length} shown of ${stories.length}</div>
        ${itemRows}
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <button class="button" onclick="generateTeamsUpdate('heuristic')" ${teamsLoading ? 'disabled' : ''}>${teamsLoading && teamsLoadingMode === 'heuristic' ? 'Generating grounded draft…' : 'Generate grounded draft'}</button>
            <button class="button secondary" onclick="generateTeamsUpdate('ai')" ${teamsLoading || !aiProvider ? 'disabled' : ''}>${teamsLoading && teamsLoadingMode === 'ai' ? 'Creating AI draft…' : 'Create AI draft'}</button>
            ${teamsMessage ? `<span class="src-badge ${teamsSource.startsWith('ai') ? 'ai' : ''}">source: ${escapeHtml(teamsSource)}</span>` : ''}
          </div>
          ${teamsMessage ? `<button class="button secondary" onclick="copyTeamsMessage()">Copy</button>` : ''}
        </div>
        ${teamsError ? `<div class="card" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border);margin-bottom:14px;"><strong>Error:</strong> ${escapeHtml(teamsError)}</div>` : ''}
        <div class="card">
          <div class="section-heading">
            <h4>Draft Preview</h4>
            <span class="micro">editable output</span>
          </div>
          ${teamsMessage
            ? `<textarea style="width:100%;min-height:260px;" oninput="setTeamsField('message', this.value)">${escapeHtml(teamsMessage)}</textarea>`
            : '<p>Select work items on the left, then click “Generate Teams draft”. The draft is grounded only in the selected items and is editable before you copy.</p>'}
        </div>
        <div class="note" style="margin-top:14px;">Grounded draft uses selected items only. AI drafts are optional, reviewable, and available only when a provider key is configured.</div>
      </div>
    </div>
  `;
}

function setTeamsField(field, value) {
  if (field === 'recipient') teamsRecipient = value;
  else if (field === 'subject') teamsSubject = value;
  else if (field === 'message') teamsMessage = value;
}

function toggleTeamsStory(id) {
  if (teamsSelectedStories.has(id)) teamsSelectedStories.delete(id); else teamsSelectedStories.add(id);
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
}

function setTeamsAssigneeFilter(index) {
  const project = projects[selectedProject];
  const owner = teamsOwnersOf(project)[index];
  if (owner === undefined) return;
  teamsAssigneeFilter = teamsAssigneeFilter === owner ? 'all' : owner;
  teamsPanel.innerHTML = renderTeamsPanel(project);
}

function setTeamsFilter(field, value) {
  if (field === 'assignee') teamsAssigneeFilter = value;
  else if (field === 'status') teamsStatusFilter = value;
  else if (field === 'sprint') teamsSprintFilter = value;
  else if (field === 'search') teamsSearch = value;
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
  if (field === 'search') {
    const search = document.getElementById('teams-search');
    if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }
}

function selectAllTeams() {
  const project = projects[selectedProject];
  filteredTeamsStories(project).forEach(s => teamsSelectedStories.add(s.id));
  teamsPanel.innerHTML = renderTeamsPanel(project);
}

function clearTeamsSelection() {
  teamsSelectedStories.clear();
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
}

async function generateTeamsUpdate(mode = 'heuristic') {
  if (!selectedProject) return;
  if (teamsSelectedStories.size === 0) {
    alert('Select at least one item.');
    return;
  }
  teamsLoading = true;
  teamsLoadingMode = mode;
  teamsError = '';
  teamsMessage = '';
  teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
  try {
    const response = await fetch('/api/project/teams-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: selectedProject,
        recipient: teamsRecipient,
        subject: teamsSubject,
        storyIds: [...teamsSelectedStories],
        mode
      })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unable to generate update' }));
      throw new Error(error.error || 'Unable to generate update');
    }
    const result = await response.json();
    teamsMessage = result.message || '';
    teamsSource = result.source || '';
  } catch (error) {
    teamsError = error.message;
  } finally {
    teamsLoading = false;
    teamsLoadingMode = '';
    teamsPanel.innerHTML = renderTeamsPanel(projects[selectedProject]);
  }
}

function copyTeamsMessage() {
  if (!teamsMessage) { alert('Nothing to copy yet.'); return; }
  copyText(teamsMessage);
}

function copyStatusReport() {
  if (!projectStatusReport) { alert('Nothing to copy yet.'); return; }
  copyText(projectStatusReport, 'Copied status summary.');
}

// Tracking is CROSS-PROJECT: it lists every tracked item (Story with tracked=true) across
// all projects. Items carry the former ticket fields (jiraId, owner, contacted, comment…).
function renderTrackingPanel() {
  const projectNames = Object.keys(projects);
  const threshold = settings.commentStaleDays || 7;
  const arg = eventArg;

  const items = allTrackedItems(); // [{ project, story }]
  const quiet = items.filter(x => itemNeedsComment(x.story));
  const quietCount = quiet.length;
  const quietOwners = [...new Set(quiet.map(x => storyAssignee(x.story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const search = trackingSearch.trim().toLowerCase();

  const filtered = items.filter(x => {
    const s = x.story;
    if (trackingFilter === 'followup' && !itemNeedsFollowup(s)) return false;
    if (trackingFilter === 'needscomment' && !itemNeedsComment(s)) return false;
    if (trackingProjectFilter !== 'all' && x.project !== trackingProjectFilter) return false;
    if (search) {
      const hay = [s.jiraId, s.summary, storyAssignee(s), storySprint(s), inferStatusClient(s), storyLastCommentText(s), x.project].map(v => String(v || '').toLowerCase()).join(' ');
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const priority = (s) => (itemNeedsFollowup(s) ? 2 : 0) + (itemNeedsComment(s) ? 1 : 0);
  const sorted = filtered.slice().sort((a, b) => priority(b.story) - priority(a.story));

  const cardHtml = (x) => {
    const s = x.story, p = x.project;
    const flag = itemNeedsFollowup(s);
    const q = itemNeedsComment(s);
    const expanded = trackingExpanded.has(`${p}::${s.id}`);
    const signal = flag ? { badge: 'followup', label: 'Needs follow-up', detail: storyAssignee(s) ? `Assignee not contacted: ${storyAssignee(s)}` : 'Assignee not contacted' }
      : q ? { badge: 'quiet', label: 'Quiet thread', detail: `No comment in ${threshold}+ days · ${lastCommentLabel(s)}` }
      : { badge: statusBadgeClass(inferStatusClient(s)), label: inferStatusClient(s), detail: storyLastCommentText(s) || 'No recent Jira comment recorded' };
    const linkedMilestone = (projects[p].timeline || []).find(entry => entry.id === s.timelineId);
    const notePreview = previewText(storyLastCommentText(s), 160) || signal.detail;
    return `
      <div class="console-row followup-row">
        <div class="console-row-top">
          <div style="min-width:0;flex:1;">
            <div class="console-row-meta">
              <span class="mono" style="font-size:0.74rem;color:var(--muted-2);">${escapeHtml(p)}</span>
              ${s.jiraId ? `<span class="mono" style="font-size:0.74rem;color:var(--accent);">${escapeHtml(s.jiraId)}</span>` : ''}
              ${statusBadge(inferStatusClient(s))}
              <span class="badge ${signal.badge}">${escapeHtml(signal.label)}</span>
            </div>
            <h4 style="margin:8px 0 4px;">${escapeHtml(s.summary || 'Untitled work item')}</h4>
            <p>${escapeHtml(signal.detail)}</p>
          </div>
          <div class="console-actions">
            <button class="button button-small secondary" onclick="toggleTrackingExpanded(${arg(p)}, ${arg(s.id)})">${expanded ? 'Collapse' : 'Expand'}</button>
            <button class="button button-small secondary" onclick="logItemComment(${arg(p)}, ${arg(s.id)})">✓ Comment today</button>
            <button class="button button-small danger" onclick="untrackItem(${arg(p)}, ${arg(s.id)})" title="Stop tracking (keeps the work item)">Untrack</button>
          </div>
        </div>
        <div class="triage-field-strip compact">
          <div class="triage-field ${storyAssignee(s) ? '' : 'warn'}"><span class="micro">Assignee</span><strong>${escapeHtml(storyAssignee(s) || 'Unassigned')}</strong></div>
          <div class="triage-field ${storySprint(s) ? '' : 'warn'}"><span class="micro">Sprint</span><strong>${escapeHtml(storySprint(s) || 'Not set')}</strong></div>
          <div class="triage-field ${q ? 'info' : ''}"><span class="micro">Comment Date</span><strong>${escapeHtml(lastCommentLabel(s))}</strong></div>
          <div class="triage-field ${linkedMilestone ? '' : 'info'}"><span class="micro">Milestone</span><strong>${escapeHtml(linkedMilestone ? linkedMilestone.title : 'Not linked')}</strong></div>
        </div>
        <div class="console-snippet">
          <span class="micro">Last comment / PM note</span>
          <p>${escapeHtml(notePreview)}</p>
        </div>
        ${expanded ? `
          <div class="console-expanded">
            <div class="tracking-edit-grid">
              <div><label>Assignee</label><input value="${escapeHtml(storyAssignee(s))}" onchange="updateItemField(${arg(p)}, ${arg(s.id)}, ${arg('assignee')}, this.value)" /></div>
              <div><label>Sprint</label>${sprintSelectHtml(`tracking-${escapeHtml(s.id)}`, storySprint(s), `onchange="updateItemField(${arg(p)}, ${arg(s.id)}, ${arg('sprint')}, this.value)"`)}</div>
              <div><label>Last comment / PM note</label><input value="${escapeHtml(storyLastCommentText(s))}" onchange="updateItemLastComment(${arg(p)}, ${arg(s.id)}, this)" /></div>
            </div>
            <div class="console-flag-row">
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" ${s.contacted ? 'checked' : ''} onchange="setItemFlag(${arg(p)}, ${arg(s.id)}, ${arg('contacted')}, this.checked)" /> Contacted</label>
              <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" ${s.commentAdded ? 'checked' : ''} onchange="setItemFlag(${arg(p)}, ${arg(s.id)}, ${arg('commentAdded')}, this.checked)" /> Comment logged</label>
            </div>
          </div>` : ''}
      </div>`;
  };

  const cards = sorted.length
    ? `<div class="console-list">${sorted.map(cardHtml).join('')}</div>`
    : `<div class="card"><p>${items.length ? 'No tracked items match the filter.' : 'Nothing tracked yet — use “+ New tracked item”, or flip “Track” on a work item.'}</p></div>`;

  const quietBanner = (quietCount && !trackingCommentBannerDismissed) ? `
    <div class="banner">
      <div>
        <strong style="color:var(--info);">${quietCount} tracked item${quietCount === 1 ? '' : 's'} ${quietCount === 1 ? 'has' : 'have'} gone quiet</strong> <span style="color:var(--muted);">— no comment logged in over ${threshold} days — nudge the assignee${quietCount === 1 ? '' : 's'} for a status update${quietOwners.length ? `: <strong>${escapeHtml(quietOwners.join(', '))}</strong>` : ''}.</span>
        ${trackingFilter !== 'needscomment' ? ` <a href="#" onclick="setTrackingFilter('needscomment');return false;">Show only these</a>` : ''}
      </div>
      <button class="button button-small secondary" onclick="dismissCommentBanner()">Dismiss</button>
    </div>` : '';

  // Always-on per-owner attention chips across all tracked items.
  const owners = [...new Set(items.map(x => storyAssignee(x.story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const ownerChips = owners.map(o => {
    const its = items.filter(x => storyAssignee(x.story) === o);
    const fu = its.filter(x => itemNeedsFollowup(x.story)).length;
    const nc = its.filter(x => itemNeedsComment(x.story)).length;
    const cls = fu ? 'warn' : (nc ? 'info' : '');
    const label = fu ? `${fu} follow-up` : (nc ? `${nc} quiet` : '0');
    return `<span class="owner-chip ${cls}" style="cursor:pointer;" onclick="setTrackingSearch(${escapeHtml(JSON.stringify(o))})" title="Filter to ${escapeHtml(o)}">${escapeHtml(o)} · ${label}</span>`;
  }).join('');

  const pill = (val, label) => `<button class="pill ${trackingFilter === val ? 'active' : ''}" onclick="setTrackingFilter('${val}')">${label}</button>`;

  // Work items not yet tracked, for the "track an existing item" picker (value = JSON [project, id]).
  const untracked = [];
  projectNames.forEach(n => (projects[n].stories || []).forEach(s => { if (!s.tracked) untracked.push({ project: n, story: s }); }));

  const addForm = trackingShowAddForm ? `
      <div class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);margin-bottom:14px;">
        <div style="margin-bottom:12px;"><strong style="color:var(--accent);">New tracked item</strong> <span class="micro" style="text-transform:none;">— a work item flagged for follow-up</span></div>
        <div class="form-grid">
          <div class="field-row">
            <div><label>Project</label><select id="new-item-project">${projectNames.map(n => `<option ${(n === (selectedProject || projectNames[0])) ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></div>
            <div><label>Title</label><input id="new-item-title" placeholder="Short title" /></div>
          </div>
          <div class="form-row"><label>Description</label><textarea id="new-item-description"></textarea></div>
          <div class="form-row"><label>Labels (sets status: done / in-progress / blocked / planned)</label><input id="new-item-labels" /></div>
          ${trackingFieldsHtml('new-item', { tracked: true }, false)}
          <div style="display:flex;gap:8px;">
            <button class="button" onclick="createTrackedItem()">Add tracked item</button>
            <button class="button secondary" onclick="toggleAddTrackedForm()">Cancel</button>
          </div>
        </div>
      </div>` : '';

  return `
    ${quietBanner}
    <div class="card hero-card screen-lead followup-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Follow-up command queue</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Cross-project follow-up</h3>
          <p style="margin:0;">Use this queue to manage assignee contact, stale Jira threads, and the work items most likely to go quiet if left alone.</p>
        </div>
        <div class="hero-actions">
          <button class="button" onclick="toggleAddTrackedForm()">+ New tracked item</button>
          <button class="button secondary" onclick="exportTrackingCSV()">Export CSV</button>
        </div>
      </div>
    </div>
    ${renderWorkTabs('tracking')}
    <div class="signal-grid operating-metrics followup-metrics">
      <div class="signal-card">
        <div class="micro">Tracked Items</div>
        <div class="signal-value">${items.length}</div>
        <p>${sorted.length} currently visible in this view.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Needs Follow-Up</div>
        <div class="signal-value">${items.filter(x => itemNeedsFollowup(x.story)).length}</div>
        <p>Open tracked work whose assignee has not been contacted.</p>
      </div>
      <div class="signal-card">
        <div class="micro">Quiet Threads</div>
        <div class="signal-value">${quietCount}</div>
        <p>No Jira comment in at least ${threshold} days.</p>
      </div>
    </div>
    <div class="card followup-workbench">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <div class="pill-group">
          ${pill('all', 'All')}
          ${pill('followup', 'Needs follow-up')}
          ${pill('needscomment', 'Needs comment')}
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <span class="mono" style="font-size:0.8rem;color:var(--muted);">Quiet after <input type="number" min="1" max="365" value="${threshold}" onchange="setCommentStaleDays(this.value)" style="width:54px;display:inline-block;padding:5px 7px;" /> days</span>
          <span class="micro">${sorted.length} of ${items.length}</span>
        </div>
      </div>
      ${owners.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${ownerChips}</div>` : ''}
      ${addForm}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
        <select onchange="setTrackingProjectFilter(this.value)" style="width:auto;">
          <option value="all" ${trackingProjectFilter === 'all' ? 'selected' : ''}>All projects</option>
          ${projectNames.map(n => `<option value="${escapeHtml(n)}" ${trackingProjectFilter === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select>
        <input id="tracking-search" value="${escapeHtml(trackingSearch)}" placeholder="Search project, jira, summary, assignee, sprint…" oninput="setTrackingSearch(this.value)" style="flex:1;min-width:180px;" />
        ${untracked.length ? `<select onchange="if(this.value)trackExistingStory(this.value)" style="width:auto;max-width:260px;">
          <option value="">+ Track an existing work item…</option>
          ${untracked.map(x => `<option value="${escapeHtml(JSON.stringify([x.project, x.story.id]))}">${escapeHtml(x.project)} — ${escapeHtml(x.story.summary)}</option>`).join('')}
        </select>` : ''}
      </div>
      ${cards}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
        <div class="note warn">amber = needs follow-up · open (status ≠ Done) AND Contacted? false</div>
        <div class="note info">indigo = comment gone quiet · lastCommentedAt null / older than threshold — independent rule</div>
      </div>
    </div>
  `;
}

function toggleAddTrackedForm() {
  trackingShowAddForm = !trackingShowAddForm;
  trackingPanel.innerHTML = renderTrackingPanel();
  if (trackingShowAddForm) { const el = document.getElementById('new-item-title'); if (el) el.focus(); }
}

async function createTrackedItem() {
  const g = id => document.getElementById(id);
  const project = g('new-item-project') ? g('new-item-project').value : selectedProject;
  const title = g('new-item-title') ? g('new-item-title').value.trim() : '';
  const tf = readTrackingFields('new-item'); // jiraId, owner, contacted, commentAdded, lastUpdate
  if (!project) { alert('Pick a project.'); return; }
  if (!title && !tf.jiraId) { alert('Enter at least a title or a Jira id.'); return; }
  const response = await saveRequest('/api/project/story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project,
      summary: title || tf.jiraId,
      description: g('new-item-description') ? g('new-item-description').value.trim() : '',
      labels: g('new-item-labels') ? g('new-item-labels').value.trim() : '',
      tracked: true,
      ...tf
    })
  });
  if (!response) return;
  trackingShowAddForm = false;
  await refreshProject();
}

async function trackExistingStory(value) {
  let project, id;
  try { [project, id] = JSON.parse(value); } catch (_) { return; }
  const response = await saveRequest('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, tracked: true })
  });
  if (!response) return;
  await refreshProject();
}

async function untrackItem(project, id) {
  const response = await saveRequest('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, tracked: false })
  });
  if (!response) return;
  await refreshProject();
}

// Text-field edits: update in-memory + PUT, no re-render (keeps typing focus).
async function updateItemField(project, id, field, value) {
  const response = await saveRequest('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, [field]: value })
  });
  if (!response) return;
  const p = projects[project];
  if (p) { const s = (p.stories || []).find(x => x.id === id); if (s) s[field] = value; }
}

// Checkbox flags (contacted / commentAdded): PUT then refresh so highlights recompute.
async function setItemFlag(project, id, field, checked) {
  const response = await saveRequest('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, [field]: checked })
  });
  if (!response) return;
  await refreshProject();
}

async function updateItemLastComment(project, id, el) {
  let value = el.value.trim();
  if (value && !/^\d{1,2}\/\d{1,2}/.test(value)) {
    const now = new Date();
    value = `${now.getMonth() + 1}/${now.getDate()} - ${value}`;
    el.value = value;
  }
  await updateItemField(project, id, 'lastComment', value);
}

// "✓ today" — record a comment now (server stamps lastCommentedAt, sets commentAdded).
async function logItemComment(project, id) {
  const response = await saveRequest('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, logComment: true })
  });
  if (!response) return;
  await refreshProject();
}

async function setCommentStaleDays(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 365) { alert('Enter a number of days between 1 and 365.'); return; }
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentStaleDays: n })
    });
    if (!response.ok) throw new Error('save failed');
    settings = await response.json();
  } catch (error) {
    console.warn('Failed to save staleness threshold:', error.message);
  }
  trackingPanel.innerHTML = renderTrackingPanel();
  portfolioPanel.innerHTML = renderPortfolioPanel();
  renderNavBadges();
}

function dismissCommentBanner() {
  trackingCommentBannerDismissed = true;
  trackingPanel.innerHTML = renderTrackingPanel();
}

function exportTrackingCSV() {
  const items = allTrackedItems();
  if (!items.length) { alert('No tracked items to export.'); return; }
  const header = ['Project', 'Jira', 'Summary', 'Status', 'Assignee', 'Sprint', 'Contacted?', 'Comment Added?', 'Comment Date', 'Needs Comment?', 'Last Comment'];
  const rows = items.map(({ project, story: s }) => [project, s.jiraId, s.summary, inferStatusClient(s), storyAssignee(s), storySprint(s), s.contacted ? 'Yes' : 'No', s.commentAdded ? 'Yes' : 'No', lastCommentLabel(s), itemNeedsComment(s) ? 'Yes' : 'No', storyLastCommentText(s)]);
  const csv = [header].concat(rows)
    .map(r => r.map(PMSecurity.csvCell).join(','))
    .join('\n');
  downloadFile('tracking-all-projects.csv', csv, 'text/csv');
}

function setTrackingFilter(value) {
  trackingFilter = value;
  trackingPanel.innerHTML = renderTrackingPanel();
}

function setTrackingProjectFilter(value) {
  trackingProjectFilter = value;
  trackingPanel.innerHTML = renderTrackingPanel();
}

function setTrackingSearch(value) {
  trackingSearch = value;
  trackingPanel.innerHTML = renderTrackingPanel();
  const el = document.getElementById('tracking-search');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

function renderReportsPanel() {
  if (!selectedProject) {
    return '<p>Select a project to draft a status summary.</p>';
  }

  const project = projects[selectedProject];
  const stories = (project && project.stories) || [];
  const timeline = (project && project.timeline) || [];
  const transcripts = (project && project.transcripts) || [];
  const tracked = stories.filter(story => story.tracked);
  const blocked = stories.filter(story => inferStatusClient(story) === 'Blocked');
  const followup = tracked.filter(itemNeedsFollowup);
  const quiet = tracked.filter(itemNeedsComment);
  const overdue = timeline.filter(entry => milestoneHealth(entry).label === 'Overdue');
  const dueSoon = timeline.filter(entry => milestoneHealth(entry).label === 'Due soon');
  const undated = timeline.filter(entry => milestoneHealth(entry).label === 'No date');
  const linkedMilestones = timeline.filter(entry => stories.some(story => story.timelineId === entry.id)).length;
  const storiesWithUpdates = stories.filter(story => (story.updates || []).length > 0).length;
  const assigneeGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyAssignee(story)).length;
  const sprintGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storySprint(story)).length;
  const commentGapCount = stories.filter(story => inferStatusClient(story) !== 'Done' && !storyLastCommentText(story)).length;

  const updates = [];
  stories.forEach(story => {
    (story.updates || []).forEach(update => updates.push({
      jiraId: story.jiraId || '',
      summary: story.summary || '',
      assignee: storyAssignee(story),
      status: inferStatusClient(story),
      ...update
    }));
  });
  updates.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const latestEvidenceAt = [
    ...updates.map(update => update.date).filter(Boolean),
    ...transcripts.map(item => item.date || item.uploadedAt).filter(Boolean)
  ].map(value => new Date(value).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const latestEvidenceLabel = latestEvidenceAt ? new Date(latestEvidenceAt).toLocaleDateString() : 'No dated evidence yet';

  const hasReport = !!projectStatusReport;
  const sourceBadge = hasReport ? `<span class="src-badge ${projectStatusSource.startsWith('ai') ? 'ai' : ''}">source: ${escapeHtml(projectStatusSource)}</span>` : '';
  const readinessNotes = [];
  if (!stories.length) readinessNotes.push('No work items have been added yet.');
  if (!updates.length) readinessNotes.push('No captured work-item updates are available yet.');
  if (!timeline.length) readinessNotes.push('No milestones are recorded yet.');
  if (timeline.length && linkedMilestones < timeline.length) readinessNotes.push(`${timeline.length - linkedMilestones} milestone${timeline.length - linkedMilestones === 1 ? '' : 's'} are not linked to work items.`);
  if (followup.length || quiet.length) readinessNotes.push(`${followup.length + quiet.length} follow-up signal${followup.length + quiet.length === 1 ? '' : 's'} could weaken the narrative unless refreshed.`);

  const riskItems = [
    ...blocked.map(story => ({
      badge: 'blocked',
      title: `${story.jiraId ? `${story.jiraId} · ` : ''}${story.summary}`,
      detail: story.dependencies ? `Blocked by ${story.dependencies}` : (story.notes || 'Blocked work item')
    })),
    ...followup.map(story => ({
      badge: 'followup',
      title: `${story.jiraId ? `${story.jiraId} · ` : ''}${story.summary}`,
      detail: storyAssignee(story) ? `Assignee not contacted: ${storyAssignee(story)}` : 'Assignee not contacted'
    })),
    ...quiet.map(story => ({
      badge: 'quiet',
      title: `${story.jiraId ? `${story.jiraId} · ` : ''}${story.summary}`,
      detail: `No recent Jira comment · ${lastCommentLabel(story)}`
    })),
    ...overdue.map(entry => ({
      badge: 'blocked',
      title: entry.title,
      detail: `Milestone overdue${entry.date ? ` · ${entry.date}` : ''}`
    })),
    ...dueSoon.map(entry => ({
      badge: 'followup',
      title: entry.title,
      detail: `Milestone due soon${entry.date ? ` · ${entry.date}` : ''}`
    }))
  ].slice(0, 8);

  const riskHtml = riskItems.length
    ? riskItems.map((item, index) => `
      <div class="surface-row"${index === riskItems.length - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p style="margin:4px 0 0;">${escapeHtml(item.detail)}</p>
          </div>
          <span class="badge ${item.badge}">${item.badge === 'followup' ? 'FOLLOW-UP' : item.badge === 'quiet' ? 'QUIET' : 'RISK'}</span>
        </div>
      </div>`).join('')
    : '<p>No current blockers, milestone pressure, or quiet follow-up signals are recorded.</p>';

  const evidenceHtml = updates.length
    ? updates.slice(0, 6).map((item, index) => `
      <div class="surface-row"${index === Math.min(updates.length, 6) - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
          <div style="min-width:0;flex:1;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              ${item.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.78rem;">${escapeHtml(item.jiraId)}</span>` : ''}
              <strong>${escapeHtml(item.summary)}</strong>
              <span class="badge ${item.status === 'Blocked' ? 'blocked' : item.status === 'Done' ? 'done' : 'inprogress'}">${escapeHtml(item.status)}</span>
            </div>
            <p style="margin:4px 0 0;">${escapeHtml(item.update || item.excerpt || 'No update text available.')}</p>
            <div class="micro" style="margin-top:6px;text-transform:none;">${escapeHtml(item.date || 'No date')} · ${escapeHtml(item.source || item.transcriptTitle || 'Captured update')}</div>
          </div>
          ${item.assignee ? `<span class="owner-chip">${escapeHtml(item.assignee)}</span>` : ''}
        </div>
      </div>`).join('')
    : '<p>No captured work-item updates yet. Use Capture to bring in DSU or meeting evidence before drafting.</p>';

  const summaryPreview = hasReport
    ? `<div class="card summary-report-card"><pre class="status-report" style="background:var(--bg);border:1px solid var(--border);padding:14px;border-radius:10px;overflow-x:auto;white-space:pre-wrap;margin:0;">${escapeHtml(projectStatusReport)}</pre></div>`
    : `<div class="card summary-report-card">
        <div class="section-heading">
          <h4>Draft Preview</h4>
          <span class="micro">generated output</span>
        </div>
        <p>No summary yet. Generate a draft when the evidence and risk framing on this page look good enough to brief from.</p>
      </div>`;

  return `
    <div class="card hero-card screen-lead summary-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Executive-ready summary workspace</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">${escapeHtml(selectedProject)} status summary</h3>
          <p style="margin:0;">Grounded only in saved work items, milestones, transcripts, and extracted updates. This screen is meant to help you see whether the draft is supportable before you generate it.</p>
        </div>
        <div class="hero-actions">
          <button class="button" onclick="generateStatusReport('heuristic')" ${statusReportLoading ? 'disabled' : ''}>${statusReportLoading && statusReportLoadingMode === 'heuristic' ? 'Generating grounded summary…' : 'Generate grounded summary'}</button>
          <button class="button secondary" onclick="generateStatusReport('ai')" ${statusReportLoading || !aiProvider ? 'disabled' : ''}>${statusReportLoading && statusReportLoadingMode === 'ai' ? 'Creating AI draft…' : 'Create AI draft'}</button>
          ${hasReport ? '<button class="button secondary" onclick="copyStatusReport()">Copy summary</button>' : ''}
          <button class="button secondary" onclick="openCapture()">Capture evidence</button>
          <button class="button secondary" onclick="openWorkItems()">Review work items</button>
        </div>
      </div>
    </div>
    ${renderCommunicateTabs('reports')}
    <div class="insight-strip operating-metrics summary-metrics">
      <div class="insight-tile">
        <div class="micro">Current Risk</div>
        <div class="insight-number">${blocked.length + followup.length + quiet.length}</div>
        <div class="insight-copy">${blocked.length} blocked · ${followup.length} need contact · ${quiet.length} quiet Jira threads</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Milestone Pressure</div>
        <div class="insight-number">${overdue.length + dueSoon.length}</div>
        <div class="insight-copy">${overdue.length} overdue · ${dueSoon.length} due within 7 days</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Evidence Depth</div>
        <div class="insight-number">${updates.length}</div>
        <div class="insight-copy">${updates.length} captured updates across ${storiesWithUpdates} of ${stories.length} work items</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Evidence Gaps</div>
        <div class="insight-number">${assigneeGapCount + sprintGapCount + commentGapCount}</div>
        <div class="insight-copy">${assigneeGapCount} assignee gaps · ${sprintGapCount} sprint gaps · ${commentGapCount} comment gaps</div>
      </div>
    </div>
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Grounding Check</h4>
          <span class="micro">what the draft can rely on</span>
        </div>
        <div class="stack">
          <div class="surface-row">
            <strong>${stories.length} work item${stories.length === 1 ? '' : 's'}</strong>
            <p>Status, assignees, Jira IDs, sprint context, notes, dependencies, and captured updates can all feed the summary when present.</p>
          </div>
          <div class="surface-row">
            <strong>${timeline.length} milestone${timeline.length === 1 ? '' : 's'}</strong>
            <p>${linkedMilestones} linked to work items. ${undated.length ? `${undated.length} still need dates.` : 'All recorded milestones have dates.'}</p>
          </div>
          <div class="surface-row" style="padding-bottom:0;border-bottom:none;">
            <strong>${transcripts.length} captured source${transcripts.length === 1 ? '' : 's'}</strong>
            <p>Latest dated evidence: ${escapeHtml(latestEvidenceLabel)}. Source badge after generation will show whether the final draft came from AI or the grounded heuristic fallback.</p>
          </div>
        </div>
        ${sourceBadge ? `<div style="margin-top:14px;">${sourceBadge}</div>` : ''}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Readiness Notes</h4>
          <span class="micro">gaps before briefing</span>
        </div>
        ${readinessNotes.length
          ? `<div class="stack">${readinessNotes.map((note, index) => `<div class="surface-row"${index === readinessNotes.length - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}><p>${escapeHtml(note)}</p></div>`).join('')}</div>`
          : '<p>No obvious evidence gaps are visible from the saved project data.</p>'}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button secondary" onclick="openMilestones()">Review milestones</button>
          <button class="button secondary" onclick="openSettings()">AI settings</button>
        </div>
      </div>
    </div>
    ${statusReportError ? `<div class="card" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border);margin-bottom:14px;"><strong>Error:</strong> ${escapeHtml(statusReportError)}</div>` : ''}
    <div class="section-grid" style="margin-top:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Risk Framing</h4>
          <span class="micro">what leadership will ask about</span>
        </div>
        <p style="margin:0 0 8px;">Blocked work, follow-up signals, and milestone pressure rise here first so you can challenge the draft against actual operational risk.</p>
        ${riskHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Recent Evidence</h4>
          <span class="micro">captured updates</span>
        </div>
        <p style="margin:0 0 8px;">These are the freshest recorded inputs available to the summary generator.</p>
        ${evidenceHtml}
      </div>
    </div>
    <div style="margin-top:14px;">
      ${summaryPreview}
    </div>
    <div class="note" style="margin-top:14px;">Grounded summary is the factual baseline. AI is an optional, reviewable draft and never replaces it. DSU evidence extraction remains deterministic.</div>
  `;
}

// Extracted DSU updates for a single project, shown as a card at the bottom of the
// Transcripts tab (the updates are the direct product of DSU transcript uploads, so they
// live where you manage transcripts — this replaced the standalone Updates tab).
function renderTranscriptsPanel(project) {
  const transcriptCount = (project.transcripts || []).length;
  const dsuCount = (project.transcripts || []).filter(t => /dsu/i.test(t.type || '')).length;
  const extractedCount = (project.transcripts || []).reduce((sum, t) => sum + (Array.isArray(t.extractedUpdates) ? t.extractedUpdates.length : 0), 0);
  const latestSourceAt = (project.transcripts || [])
    .map(t => t.date || t.uploadedAt)
    .filter(Boolean)
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const latestSourceLabel = latestSourceAt ? new Date(latestSourceAt).toLocaleDateString() : 'No source uploaded yet';
  const badge = (type) => {
    const t = (type || '').trim();
    if (!t) return '';
    return `<span class="badge ${/dsu/i.test(t) ? 'inprogress' : 'notstarted'}" style="text-transform:uppercase;font-family:var(--mono);font-size:0.66rem;">${escapeHtml(t)}</span>`;
  };
  const rows = (project.transcripts || []).map(t => {
    if (transcriptEditing === t.id) return transcriptEditRow(t);
    const isDsu = /dsu/i.test(t.type || '');
    const extracted = Array.isArray(t.extractedUpdates) ? t.extractedUpdates.length : 0;
    const meta = [
      t.originalName || '',
      t.date || (t.uploadedAt ? new Date(t.uploadedAt).toLocaleDateString() : ''),
      t.sourceKind === 'reference' ? 'reference only' : (isDsu ? `${extracted} update${extracted === 1 ? '' : 's'} extracted` : 'no extraction')
    ].filter(Boolean).join(' · ');
    return `
      <li class="card" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong>${escapeHtml(t.title)}</strong>${badge(t.type)}
          </div>
          <div class="micro" style="margin-top:5px;text-transform:none;">${escapeHtml(meta)}</div>
          ${t.notes ? `<p style="margin-top:6px;">${escapeHtml(t.notes.slice(0, 140))}${t.notes.length > 140 ? '…' : ''}</p>` : ''}
          ${t.extractionNote ? `<p class="micro source-reference-note">${escapeHtml(t.extractionNote)}</p>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex:none;">
          <button class="button button-small secondary" onclick="startTranscriptEdit(${eventArg(t.id)})">Edit</button>
          <button class="button button-small danger" onclick="deleteItem(${eventArg(selectedProject)}, ${eventArg('transcript')}, ${eventArg(t.id)})">Delete</button>
        </div>
      </li>`;
  }).join('');

  return `
    <div class="card hero-card screen-lead capture-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Evidence capture workspace</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">Source intake and extraction</h3>
          <p style="margin:0;">Bring in DSUs, meeting notes, and other source text here. This page turns raw source material into grounded updates that power the dashboard and summary views.</p>
        </div>
      </div>
    </div>
    <div class="insight-strip operating-metrics capture-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Sources</div>
        <div class="insight-number">${transcriptCount}</div>
        <div class="insight-copy">Transcripts and notes stored for this project</div>
      </div>
      <div class="insight-tile">
        <div class="micro">DSUs</div>
        <div class="insight-number">${dsuCount}</div>
        <div class="insight-copy">Uploads that trigger story update extraction</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Extracted Updates</div>
        <div class="insight-number">${extractedCount}</div>
        <div class="insight-copy">Saved updates currently linked back to work items</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Latest Source</div>
        <div class="insight-number" style="font-size:1.05rem;line-height:1.2;">${escapeHtml(latestSourceLabel)}</div>
        <div class="insight-copy">Freshness of the current evidence base</div>
      </div>
    </div>
    <div class="card meeting-capture-card">
      <div class="section-heading">
        <h4>Structured meeting note</h4>
        <span class="micro">fast capture</span>
      </div>
      <p style="margin:0 0 14px;">Record decisions, actions, and delivery changes while they are fresh. Choose DSU only when you want the saved text considered for work-item extraction.</p>
      <div class="form-grid">
        <div class="field-row">
          <div><label>Meeting title</label><input id="meeting-title" placeholder="Weekly delivery sync" /></div>
          <div><label>Date</label><input id="meeting-date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        </div>
        <div class="field-row">
          <div><label>Type</label><select id="meeting-type"><option value="Meeting">Meeting note</option><option value="DSU">DSU / standup</option><option value="1:1">1:1</option></select></div>
          <div><label>Attendees</label><input id="meeting-attendees" placeholder="Names or roles" /></div>
        </div>
        <div class="form-row"><label>What changed or was discussed?</label><textarea id="meeting-summary" placeholder="Factual notes only. Capture work-item updates, risks, and confirmed changes."></textarea></div>
        <div class="field-row">
          <div><label>Decisions</label><textarea id="meeting-decisions" placeholder="One decision per line"></textarea></div>
          <div><label>Actions and owners</label><textarea id="meeting-actions" placeholder="One action per line, including owner when known"></textarea></div>
        </div>
        <div><button class="button" onclick="saveStructuredMeeting()">Save meeting note</button></div>
      </div>
    </div>
    <div class="card capture-intake-card">
      <div class="section-heading">
        <h4>Upload Source</h4>
        <span class="micro">intake and extraction</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <label class="dropzone" id="dropzone" onclick="document.getElementById('transcript-file').click()" ondragover="dzOver(event)" ondragleave="dzLeave(event)" ondrop="dzDrop(event)">
          <div class="dz-icon"></div>
          <div class="dz-main" id="dz-text">Drop up to 5 files, or browse</div>
          <div class="micro">10 MB per file</div>
        </label>
        <input id="transcript-file" type="file" multiple style="display:none;" onchange="dzFileChosen()" />
        <div class="form-grid">
          <div class="form-row"><input id="transcript-notes" placeholder="Batch note (optional, applies to each source)" /></div>
          <button class="button" style="width:100%;" onclick="uploadTranscript()">Upload sources</button>
        </div>
      </div>
      ${renderSelectedCaptureFiles()}
      <div class="note" style="margin-top:14px;">Set the type for each source. Only DSU items run extraction; Meeting, Interview, Call, Notes, and Other are saved as evidence only. Text sources can be extracted. Other technical file formats are retained as reference-only evidence.</div>
      ${captureUploadFeedback ? `<div class="capture-upload-feedback ${captureUploadFeedback.warning ? 'warning' : ''}">${escapeHtml(captureUploadFeedback.message)}</div>` : ''}
    </div>
    <div class="card evidence-library-card">
      <div class="section-heading">
        <h4>Source Library</h4>
        <span class="micro">saved inputs</span>
      </div>
      ${project.transcripts.length ? `<ul class="panel-list">${rows}</ul>` : '<p>No transcripts yet.</p>'}
    </div>
    ${renderProjectUpdatesCard(selectedProject, project)}
  `;
}

function transcriptEditRow(t) {
  const types = ['DSU', 'Meeting', 'Interview', 'Call', 'Notes', 'Other'];
  return `
    <li class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);">
      <div style="margin-bottom:12px;"><strong style="color:var(--accent);">Editing transcript</strong></div>
      <div class="form-grid">
        <div class="form-row"><label>Title</label><input id="edit-transcript-title" value="${escapeHtml(t.title || '')}" /></div>
        <div class="field-row">
          <div><label>Type</label>
            <select id="edit-transcript-type">
              ${types.map(o => `<option ${((t.type || '') === o) ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
          <div><label>Date</label><input id="edit-transcript-date" type="date" value="${escapeHtml((t.date || '').slice(0, 10))}" /></div>
        </div>
        <div class="form-row"><label>Notes</label><textarea id="edit-transcript-notes">${escapeHtml(t.notes || '')}</textarea></div>
        <div style="display:flex;gap:8px;">
          <button class="button" onclick="saveTranscriptEdit(${eventArg(t.id)})">Save</button>
          <button class="button secondary" onclick="cancelTranscriptEdit()">Cancel</button>
        </div>
      </div>
    </li>`;
}

function dzOver(e) { e.preventDefault(); const dz = document.getElementById('dropzone'); if (dz) dz.classList.add('dragover'); }
function dzLeave(e) { e.preventDefault(); const dz = document.getElementById('dropzone'); if (dz) dz.classList.remove('dragover'); }
function dzDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('dropzone'); if (dz) dz.classList.remove('dragover');
  setSelectedCaptureFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
}
function dzFileChosen() {
  const input = document.getElementById('transcript-file');
  setSelectedCaptureFiles(Array.from((input && input.files) || []));
}

function setSelectedCaptureFiles(files) {
  const limited = files.slice(0, 5);
  captureSelectedFiles = limited.map(file => ({ file, title: file.name, type: 'DSU' }));
  captureUploadFeedback = files.length > 5 ? { warning: true, message: 'Only the first five files were selected.' } : null;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function renderSelectedCaptureFiles() {
  if (!captureSelectedFiles.length) return '<div class="capture-selection-empty">Select files to set each source title and type before upload.</div>';
  return `<div class="capture-file-list">
    <div class="section-heading"><h4>Selected sources</h4><span class="micro">${captureSelectedFiles.length} of 5 ready</span></div>
    ${captureSelectedFiles.map((item, index) => `<div class="capture-file-row">
      <span class="mono">${index + 1}</span>
      <input value="${escapeHtml(item.title)}" aria-label="Title for ${escapeHtml(item.file.name)}" onchange="updateCaptureFile(${index}, 'title', this.value)" />
      <select aria-label="Type for ${escapeHtml(item.file.name)}" onchange="updateCaptureFile(${index}, 'type', this.value)">
        ${['DSU', 'Meeting', 'Interview', 'Call', 'Notes', 'Other'].map(type => `<option value="${type}" ${item.type === type ? 'selected' : ''}>${type}${type === 'DSU' ? ' (extract)' : ''}</option>`).join('')}
      </select>
      <button class="button button-small secondary" onclick="removeCaptureFile(${index})">Remove</button>
    </div>`).join('')}
  </div>`;
}

function updateCaptureFile(index, field, value) {
  if (captureSelectedFiles[index]) captureSelectedFiles[index][field] = value;
}

function removeCaptureFile(index) {
  captureSelectedFiles.splice(index, 1);
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}

function startTranscriptEdit(id) {
  transcriptEditing = id;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}
function cancelTranscriptEdit() {
  transcriptEditing = null;
  if (selectedProject) transcriptsPanel.innerHTML = renderTranscriptsPanel(projects[selectedProject]);
}
async function saveTranscriptEdit(id) {
  const val = i => { const el = document.getElementById(i); return el ? el.value : undefined; };
  const response = await saveRequest('/api/project/transcript', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, id, title: val('edit-transcript-title'), type: val('edit-transcript-type'), date: val('edit-transcript-date'), notes: val('edit-transcript-notes') })
  });
  if (!response) return;
  transcriptEditing = null;
  await refreshProject();
}

function renderProjectUpdatesCard(projectName, project) {
  const updates = [];
  (project.stories || []).forEach(story => {
    (story.updates || []).forEach(update => {
      updates.push({
        project: projectName,
        storyId: story.id,
        updateId: update.id,
        storySummary: story.summary,
        transcriptTitle: update.transcriptTitle,
        excerpt: update.excerpt,
        date: update.date
      });
    });
  });
  updates.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const body = updates.length ? `
      <ul class="panel-list">
        ${updates.map(item => `
          <li class="card" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div style="min-width:0;">
              <strong>${escapeHtml(item.storySummary)}</strong>
              <p style="margin:6px 0 4px;">“${escapeHtml(item.excerpt || 'No excerpt available.')}”</p>
              <span class="micro" style="text-transform:none;">from ${escapeHtml(item.transcriptTitle || 'Unknown')} · ${escapeHtml(item.date || 'no date')}</span>
            </div>
            <div style="display:flex;gap:6px;flex:none;">
              <button class="button button-small secondary" onclick="copyText(${escapeHtml(JSON.stringify(`Work item: ${item.storySummary}\nUpdate: ${item.excerpt || 'Follow up from DSU transcript.'}\nSource: ${item.transcriptTitle}`))})">Copy</button>
              <button class="button button-small danger" onclick="deleteUpdate(${escapeHtml(JSON.stringify(item.project))}, ${escapeHtml(JSON.stringify(item.storyId))}, ${escapeHtml(JSON.stringify(item.updateId))})">Remove</button>
            </div>
          </li>
        `).join('')}
      </ul>` : '<p>No extracted updates yet. Upload a DSU transcript above to create them.</p>';

  return `
    <div class="card">
      <div class="micro" style="margin-bottom:2px;">Extracted DSU updates${updates.length ? ` (${updates.length})` : ''}</div>
      <p style="margin:0 0 10px;">Per-work-item updates pulled from this project's DSU transcripts — review and copy for Jira.</p>
      ${body}
    </div>
  `;
}

function renderManagePanel() {
  const projectNames = Object.keys(projects);
  const filteredItems = getManageItems();

  const projectManagement = `
    <div class="card">
      <h4>Project Management</h4>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <button class="button" onclick="manageToggleNewProjectForm()">+ New Project</button>
      </div>
      ${showNewProjectForm ? `
        <div style="padding:12px;background:var(--accent-soft);border-radius:8px;border:1px solid var(--accent);margin-bottom:16px;">
          <div class="form-grid">
            <div class="form-row"><label>Project name</label><input id="new-project-name" placeholder="Project name" /></div>
            <div class="form-row"><label>Description</label><input id="new-project-description" placeholder="Description (optional)" /></div>
          </div>
          <div style="display:flex;gap:12px;margin-top:12px;">
            <button class="button button-small" onclick="addProject()">Create</button>
            <button class="button button-small secondary" onclick="manageToggleNewProjectForm()">Cancel</button>
          </div>
        </div>
      ` : ''}
      ${projectNames.length ? `
        <div>
          <p style="margin-bottom:12px;color:var(--muted);">Projects (${projectNames.length}):</p>
          <ul class="panel-list" style="gap:8px;">
            ${projectNames.map(name => `
              <li class="card" style="padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <div style="flex:1;">
                  <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(name)}</div>
                  ${projects[name].description ? `<div style="font-size:0.85rem;color:var(--muted);">${escapeHtml(projects[name].description)}</div>` : ''}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button class="button button-small" onclick="selectProject(${escapeHtml(JSON.stringify(name))})" ${selectedProject === name ? 'disabled' : ''}>
                    ${selectedProject === name ? 'Current' : 'Select'}
                  </button>
                  <button class="button button-small danger" onclick="deleteProject(${escapeHtml(JSON.stringify(name))})" title="Delete this project">Delete</button>
                </div>
              </li>
            `).join('')}
          </ul>
        </div>
      ` : '<p style="color:var(--muted);">No projects yet. Create one above.</p>'}
    </div>`;

  const promptEditor = `
    <div class="card advanced-settings-card">
      <details>
        <summary>Advanced: AI prompt templates</summary>
        <p>DSU extraction is deterministic. This optional template controls the AI status-summary draft only; most users can leave it unchanged.</p>
        <div class="form-row"><label>Status report prompt</label><textarea id="ai-prompt-status-report" rows="6">${escapeHtml(aiPrompts.statusReport)}</textarea></div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button class="button" onclick="saveAiPrompts()">Save AI Prompts</button>
          <span style="color:var(--success);">${aiPromptStatus}</span>
        </div>
      </details>
    </div>`;

  const workspaceSettings = `
    <div class="card">
      <h4>Workspace Settings</h4>
      <p>Control the cross-project sprint dropdown and follow-up freshness rules used across the console.</p>
      <div class="form-grid">
        <div class="form-row">
          <label>Quiet thread threshold (days)</label>
          <input id="settings-comment-stale-days" type="number" min="1" max="365" value="${escapeHtml(settings.commentStaleDays)}" />
        </div>
        <div class="form-row">
          <label>Sprint catalog</label>
          <textarea id="settings-sprint-options" rows="6" placeholder="One sprint per line">${escapeHtml((settings.sprintOptions || []).join('\n'))}</textarea>
          <div class="micro" style="margin-top:6px;text-transform:none;">Used as the controlled dropdown everywhere Sprint appears.</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="button" onclick="saveWorkspaceSettings()">Save Workspace Settings</button>
      </div>
    </div>`;

  const aiDraftingSettings = `
    <div class="card">
      <h4>AI Drafting</h4>
      <p>${aiProvider ? `Connected to ${escapeHtml(aiProvider)}. AI is available only as a reviewable draft on Status Summary and Teams Draft.` : 'Not connected. The app remains fully usable with grounded drafts. Add an OpenAI or Claude API key in web/.env, then restart the app to enable optional AI drafts.'}</p>
      <div class="note">DSU extraction always uses deterministic evidence matching. AI never automatically saves changes or sends a message.</div>
    </div>`;

  const projectDirectory = (selectedProject && projects[selectedProject]?.assigneeDirectory) || {};
  const directoryToDisplay = Object.keys(projectDirectory).length ? projectDirectory : ASSIGNEE_DIRECTORY_STARTER;
  const assigneeDirectorySettings = selectedProject ? `
    <div class="card assignee-directory-card">
      <div class="section-heading">
        <div>
          <h4>Assignee Directory</h4>
          <p>For ${escapeHtml(selectedProject)}. Map Jira usernames to the names you want to see throughout this project.</p>
        </div>
        <span class="micro">project-specific</span>
      </div>
      <div class="form-row">
        <label>Jira username = Full name</label>
        <textarea id="project-assignee-directory" rows="12" spellcheck="false">${escapeHtml(Object.entries(directoryToDisplay).sort(([a], [b]) => a.localeCompare(b)).map(([alias, name]) => `${alias} = ${name}`).join('\n'))}</textarea>
        <div class="micro form-help">One mapping per line. Saving also updates existing matching work items. Future CSV imports use this directory automatically.</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="button" onclick="saveAssigneeDirectory()">Save and update work items</button>
      </div>
    </div>` : `
    <div class="card assignee-directory-card">
      <h4>Assignee Directory</h4>
      <p>Select a project from the sidebar to manage that project's Jira username mappings.</p>
    </div>`;

  const savedStatusMappings = (selectedProject && projects[selectedProject]?.statusMappings) || {};
  const statusMappingsToDisplay = Object.keys(savedStatusMappings).length ? savedStatusMappings : PROJECT_STATUS_MAPPING_STARTER;
  const statusMappingSettings = selectedProject ? `
    <div class="card status-mapping-card">
      <div class="section-heading">
        <div>
          <h4>Jira Status Mapping</h4>
          <p>For ${escapeHtml(selectedProject)}. Match this project's Jira workflow names to the operational statuses used for triage and reporting.</p>
        </div>
        <span class="micro">project-specific</span>
      </div>
      <div class="form-row">
        <label>Jira Status = Operational Status</label>
        <textarea id="project-status-mappings" rows="12" spellcheck="false">${escapeHtml(Object.entries(statusMappingsToDisplay).map(([jiraStatus, operatingStatus]) => `${jiraStatus} = ${operatingStatus}`).join('\n'))}</textarea>
        <div class="micro form-help">Allowed operational statuses: Blocked, In progress, Active, Planned, Done, Not started. Saving also updates work items that retain an original Jira status label.</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button class="button" onclick="saveProjectStatusMappings()">Save and update work items</button>
      </div>
    </div>` : `
    <div class="card status-mapping-card">
      <h4>Jira Status Mapping</h4>
      <p>Select a project from the sidebar to manage that project's Jira workflow mappings.</p>
    </div>`;

  if (!projectNames.length) {
    return `
      <div class="card hero-card screen-lead settings-lead" style="margin-bottom:14px;">
        <div class="micro" style="margin-bottom:8px;">Workspace configuration</div>
        <h3 style="margin:0 0 8px;">Settings and data controls</h3>
        <p style="margin:0;">This page manages the operating system behind the app: projects, sprint catalog, AI prompt behavior, and exported workspace data.</p>
      </div>
      <div class="settings-grid">
        ${projectManagement}
        ${workspaceSettings}
      </div>
      ${aiDraftingSettings}
      ${promptEditor}
      <div class="card">
        <p>No projects available yet. Create one above to get started.</p>
      </div>
    `;
  }

  return `
    <div class="card hero-card screen-lead settings-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Workspace configuration</div>
      <h3 style="margin:0 0 8px;">Settings and data controls</h3>
      <p style="margin:0;">Use this page to manage the workspace itself: project records, sprint vocabulary, AI prompt behavior, and raw data exports.</p>
    </div>
    <div class="settings-grid">
      ${projectManagement}
      ${workspaceSettings}
    </div>
    ${aiDraftingSettings}
    <div class="settings-grid">
      ${assigneeDirectorySettings}
      ${statusMappingSettings}
    </div>
    <div class="settings-grid settings-grid-secondary">
      ${promptEditor}
      <div class="card workspace-data-card">
      <h4>Workspace Data</h4>
      <div class="form-grid">
        <div class="form-row"><label>Search</label><input id="manage-search" type="text" placeholder="Search items" value="${manageSearch}" oninput="setManageFilter('search', this.value)" /></div>
        <div class="form-row"><label>Project</label>
          <select id="manage-project-filter" onchange="setManageFilter('project', this.value)">
            <option value="">All projects</option>
            ${projectNames.map(name => `<option value="${escapeHtml(name)}" ${manageProjectFilter === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"><label>Type</label>
          <select id="manage-type-filter" onchange="setManageFilter('type', this.value)">
            <option value="">All item types</option>
            <option value="story" ${manageTypeFilter === 'story' ? 'selected' : ''}>Work Items</option>
            <option value="timeline" ${manageTypeFilter === 'timeline' ? 'selected' : ''}>Milestones</option>
            <option value="transcript" ${manageTypeFilter === 'transcript' ? 'selected' : ''}>Transcripts</option>
          </select>
        </div>
        <div class="form-row"><label>Sort by</label>
          <select id="manage-sort-key" onchange="setManageFilter('sortKey', this.value)">
            <option value="date" ${manageSortKey === 'date' ? 'selected' : ''}>Date</option>
            <option value="type" ${manageSortKey === 'type' ? 'selected' : ''}>Type</option>
            <option value="project" ${manageSortKey === 'project' ? 'selected' : ''}>Project</option>
          </select>
        </div>
        <div class="form-row"><label>Direction</label>
          <select id="manage-sort-direction" onchange="setManageFilter('sortDirection', this.value)">
            <option value="desc" ${manageSortDirection === 'desc' ? 'selected' : ''}>Newest / A → Z</option>
            <option value="asc" ${manageSortDirection === 'asc' ? 'selected' : ''}>Oldest / Z → A</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <button class="button" onclick="exportManageCSV()">Export CSV</button>
        <button class="button" onclick="exportManageMarkdown()">Export Markdown</button>
      </div>
      <p>${filteredItems.length} item(s) found</p>
      ${filteredItems.length ? `
        <ul class="panel-list">
          ${filteredItems.map(item => {
            const isEditing = manageEditing && manageEditing.project === item.project && manageEditing.type === item.type && manageEditing.id === item.id;
            if (isEditing) {
              const nameValue = manageEditData.title || item.title;
              const detailsValue = manageEditData.details || item.details;
              const metaValue = manageEditData.meta || item.meta;
              const dateValue = manageEditData.date || item.date;
              const linkedValue = manageEditData.linked || item.linked;

              return `
                <li class="card">
                  <div class="form-grid">
                    <div class="form-row"><label>Title</label><input id="edit-title-${item.id}" value="${escapeHtml(nameValue)}" onchange="updateManageEditField('title', this.value)" /></div>
                    <div class="form-row"><label>Details</label><textarea id="edit-details-${escapeHtml(item.id)}" onchange="updateManageEditField('details', this.value)">${escapeHtml(detailsValue)}</textarea></div>
                    ${item.type === 'Story' ? `<div class="form-row"><label>Labels</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    ${item.type === 'Timeline' ? `<div class="form-row"><label>Status</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    ${item.type === 'Transcript' ? `<div class="form-row"><label>Type</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    ${item.type === 'Ticket' ? `<div class="form-row"><label>Status</label><input id="edit-meta-${item.id}" value="${escapeHtml(metaValue)}" onchange="updateManageEditField('meta', this.value)" /></div>` : ''}
                    <div class="form-row"><label>Date</label><input id="edit-date-${item.id}" type="date" value="${escapeHtml(dateValue)}" onchange="updateManageEditField('date', this.value)" /></div>
                    <div style="display:flex;gap:8px;">
                      <button class="button" onclick="saveManageEdit(${eventArg(item.project)}, ${eventArg(item.type.toLowerCase())}, ${eventArg(item.id)})">Save</button>
                      <button class="button secondary" onclick="cancelManageEdit()">Cancel</button>
                    </div>
                  </div>
                </li>
              `;
            }

            return `
              <li class="card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                  <div>
                    <h4>${escapeHtml(item.title)}</h4>
                    <p>${item.details ? escapeHtml(item.details.slice(0, 140)) + (item.details.length > 140 ? '...' : '') : 'No details'}</p>
                    <small>${escapeHtml(item.type)} · ${escapeHtml(item.project)} · ${escapeHtml(item.date || 'No date')}</small>
                    <div style="margin-top:8px;"><small>${escapeHtml(item.meta)}</small></div>
                    ${item.linked ? `<div><small>${item.linkedLabel || 'Linked'}: ${escapeHtml(item.linked)}</small></div>` : ''}
                  </div>
                  <div style="display:flex;flex-direction:column;gap:8px;">
                    <button class="button button-small secondary" onclick="startManageEdit(${eventArg(item.project)}, ${eventArg(item.type)}, ${eventArg(item.id)})">Edit</button>
                    <button class="button button-small danger" onclick="deleteItem(${eventArg(item.project)}, ${eventArg(item.type.toLowerCase())}, ${eventArg(item.id)})">Delete</button>
                  </div>
                </div>
              </li>
            `;
          }).join('')}
        </ul>
      ` : '<p>No items match the filter.</p>'}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[tag]));
}

// Inline handlers receive JSON-encoded values, not raw locally stored text.
function eventArg(value) {
  return escapeHtml(JSON.stringify(value));
}

function setManageFilter(name, value) {
  if (name === 'search') manageSearch = value;
  if (name === 'project') manageProjectFilter = value;
  if (name === 'type') manageTypeFilter = value;
  if (name === 'sortKey') manageSortKey = value;
  if (name === 'sortDirection') manageSortDirection = value;
  managePanel.innerHTML = renderManagePanel();
}

function copyText(text, successMessage = 'Copied text.') {
  if (!navigator.clipboard) {
    alert('Clipboard is not available in this browser.');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    alert(successMessage);
  }).catch(() => {
    alert('Unable to copy.');
  });
}

function startManageEdit(project, type, id) {
  const item = getManageItems().find(i => i.project === project && i.type === type && i.id === id);
  if (!item) return;
  manageEditing = { project, type, id };
  manageEditData = {
    title: item.title,
    details: item.details,
    meta: item.meta,
    date: item.date
  };
  managePanel.innerHTML = renderManagePanel();
}

function updateManageEditField(field, value) {
  manageEditData = { ...manageEditData, [field]: value };
}

function cancelManageEdit() {
  manageEditing = null;
  manageEditData = {};
  managePanel.innerHTML = renderManagePanel();
}

async function saveManageEdit(project, type, id) {
  if (!manageEditing || manageEditing.project !== project || manageEditing.type !== type || manageEditing.id !== id) {
    return;
  }

  const payload = { project, id };
  if (manageEditData.title !== undefined) payload.title = manageEditData.title;
  if (manageEditData.details !== undefined) {
    if (type === 'Ticket') payload.lastUpdate = manageEditData.details;
    else payload.notes = manageEditData.details;
  }
  if (manageEditData.date !== undefined) payload.date = manageEditData.date;
  if (manageEditData.meta !== undefined) {
    if (type === 'Story') payload.labels = manageEditData.meta.split(',').map(s => s.trim()).filter(Boolean);
    if (type === 'Timeline') payload.status = manageEditData.meta;
    if (type === 'Transcript') payload.type = manageEditData.meta;
    if (type === 'Ticket') payload.status = manageEditData.meta;
  }

  const response = await saveRequest(`/api/project/${type.toLowerCase()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response) return;

  manageEditing = null;
  manageEditData = {};
  await refreshProject();
}

function buildExportRows(items) {
  return items.map(item => ({
    Type: item.type,
    Project: item.project,
    Title: item.title,
    Details: item.details,
    Meta: item.meta,
    Linked: item.linked,
    Date: item.date
  }));
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportManageCSV() {
  const items = getManageItems();
  if (!items.length) {
    alert('No items to export.');
    return;
  }

  const rows = buildExportRows(items);
  const header = Object.keys(rows[0]).join(',');
  const csv = [header].concat(rows.map(row => {
    return Object.values(row).map(PMSecurity.csvCell).join(',');
  })).join('\n');

  downloadFile('pilot-manage-export.csv', csv, 'text/csv');
}

function exportManageMarkdown() {
  const items = getManageItems();
  if (!items.length) {
    alert('No items to export.');
    return;
  }

  const rows = buildExportRows(items);
  const header = '| Type | Project | Title | Details | Meta | Linked | Date |';
  const divider = '| --- | --- | --- | --- | --- | --- | --- |';
  const body = rows.map(row => `| ${escapeMarkdown(row.Type)} | ${escapeMarkdown(row.Project)} | ${escapeMarkdown(row.Title)} | ${escapeMarkdown(row.Details)} | ${escapeMarkdown(row.Meta)} | ${escapeMarkdown(row.Linked)} | ${escapeMarkdown(row.Date)} |`).join('\n');
  const content = [header, divider, body].join('\n');

  downloadFile('pilot-manage-export.md', content, 'text/markdown');
}

function escapeMarkdown(text) {
  return PMSecurity.markdownCell(text);
}


async function deleteItem(project, type, itemId) {
  const confirmed = confirm(`Delete ${type} for project ${project}?`);
  if (!confirmed) return;

  const response = await saveRequest(`/api/project/${type}?project=${encodeURIComponent(project)}&id=${encodeURIComponent(itemId)}`, {
    method: 'DELETE'
  });
  if (!response) return;

  await refreshProject();
}

// Shared status → badge (matches the CSS .badge variants and the wireframe colors).
function statusBadgeClass(status) {
  return {
    'Done': 'done', 'In progress': 'inprogress', 'Active': 'inprogress',
    'Blocked': 'blocked', 'Planned': 'planned', 'Not started': 'notstarted'
  }[status] || 'notstarted';
}
function statusBadge(status) {
  return `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
}

function initialsFromName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  return parts.slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

function workItemSignalBadges(story, project) {
  const badges = [];
  if (story.tracked) badges.push('<span class="row-signal tracked">Tracked</span>');
  if (itemNeedsFollowup(story)) badges.push('<span class="row-signal followup">Needs follow-up</span>');
  if (itemNeedsComment(story)) badges.push('<span class="row-signal quiet">Quiet</span>');
  if (!storyAssignee(story)) badges.push('<span class="row-signal planned">Assignee gap</span>');
  if (!storySprint(story)) badges.push('<span class="row-signal planned">Sprint gap</span>');
  if (!project.timeline.find(entry => entry.id === story.timelineId)) badges.push('<span class="row-signal planned">No milestone</span>');
  return badges.join('');
}

function renderWorkItemListRow(project, story) {
  const linkedMilestone = project.timeline.find(entry => entry.id === story.timelineId);
  const attention = workItemAttentionProfile(story, project);
  const expanded = workItemExpanded.has(story.id);
  const assignee = storyAssignee(story);
  const summaryId = story.jiraId || story.id;
  const noteText = storyLastCommentText(story) || story.notes || story.description || 'No recent Jira comment or PM note recorded.';
  const noteLabel = storyLastCommentText(story) ? 'Last comment / PM note' : story.notes ? 'Project note' : 'Description';
  const noteMeta = storyLastCommentText(story) ? `Updated ${lastCommentLabel(story)}` : latestStoryActivityLabel(story);
  const attentionClass = attention.badge === 'followup' ? 'followup' : attention.badge === 'quiet' ? 'quiet' : attention.badge === 'blocked' ? 'blocked' : attention.badge;

  return `
    <li class="work-table-card${expanded ? ' expanded' : ''}">
      <button class="work-table-toggle" onclick="toggleWorkItemExpanded(${eventArg(story.id)})">
        <span class="work-table-dot ${statusBadgeClass(inferStatusClient(story))}"></span>
        <span class="work-table-summary">
          <span class="work-table-title">${escapeHtml(story.summary)}</span>
          <span class="work-table-meta">
            <span class="mono">${escapeHtml(summaryId)}</span>
            ${workItemSignalBadges(story, project)}
          </span>
        </span>
        <span class="work-table-owner${assignee ? '' : ' empty'}">
          <span class="work-table-avatar">${escapeHtml(initialsFromName(assignee))}</span>
          <span>${escapeHtml(assignee || 'Unassigned')}</span>
        </span>
        <span class="work-table-sprint">${escapeHtml(storySprint(story) || 'No sprint')}</span>
        <span class="work-table-status">${statusBadge(inferStatusClient(story))}</span>
        <span class="work-table-date">${escapeHtml(lastCommentLabel(story))}</span>
        <span class="work-table-chevron${expanded ? ' open' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
        </span>
      </button>
      ${expanded ? `
        <div class="work-table-panel">
          <div class="work-table-panel-copy">
            <div class="work-table-panel-kicker">
              <span class="row-kicker">${escapeHtml(noteLabel)}</span>
              <span class="row-meta mono">${escapeHtml(noteMeta)}</span>
            </div>
            <p>${escapeHtml(noteText)}</p>
          </div>
          <div class="work-table-panel-grid">
            <div><span class="micro">Assignee</span><strong>${escapeHtml(assignee || 'Not recorded')}</strong></div>
            <div><span class="micro">Sprint</span><strong>${escapeHtml(storySprint(story) || 'Not recorded')}</strong></div>
            <div><span class="micro">Milestone</span><strong>${escapeHtml(linkedMilestone ? linkedMilestone.title : 'Not linked')}</strong></div>
            <div><span class="micro">Comment Date</span><strong>${escapeHtml(lastCommentLabel(story))}</strong></div>
          </div>
          <div class="work-table-panel-actions">
            <span class="badge ${attentionClass}">${escapeHtml(attention.label)}</span>
            ${story.tracked ? `<button class="button button-small secondary" onclick="logItemComment(${escapeHtml(JSON.stringify(selectedProject))}, ${escapeHtml(JSON.stringify(story.id))})">Log comment</button>` : `<button class="button button-small secondary" onclick="toggleStoryTracked(${escapeHtml(JSON.stringify(selectedProject))}, ${escapeHtml(JSON.stringify(story.id))}, true)">Track for follow-up</button>`}
            <button class="button button-small secondary" onclick="startStoryEdit(${eventArg(story.id)})">Edit</button>
            ${story.tracked ? `<button class="button button-small secondary" onclick="toggleStoryTracked(${escapeHtml(JSON.stringify(selectedProject))}, ${escapeHtml(JSON.stringify(story.id))}, false)">Untrack</button>` : ''}
            <button class="button button-small danger" onclick="deleteItem(${eventArg(selectedProject)}, ${eventArg('story')}, ${eventArg(story.id)})">Delete</button>
          </div>
        </div>` : ''}
    </li>`;
}

// Shared follow-up ("tracking") field inputs, used in the Stories create/edit forms and the
// Tracking "+ New tracked item" form so an item's follow-up fields are editable from either.
function trackingFieldsHtml(prefix, s, showTracked) {
  s = s || {};
  return `
    ${showTracked ? `<label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:0.9rem;margin-bottom:4px;"><input type="checkbox" id="${prefix}-tracked" ${s.tracked ? 'checked' : ''} style="width:auto;" /> Track this item (add to the follow-up Tracking list)</label>` : ''}
    <div class="field-row">
      <div><label>Ticket / Jira id</label><input id="${prefix}-jira" value="${escapeHtml(s.jiraId || '')}" placeholder="PROJ-1205" /></div>
      <div><label>Assignee</label><input id="${prefix}-assignee" value="${escapeHtml(storyAssignee(s))}" placeholder="Name" /></div>
    </div>
    <div class="field-row">
      <div><label>Sprint</label>${sprintSelectHtml(prefix, storySprint(s))}</div>
      <div><label>Last comment / PM note</label><input id="${prefix}-lastcomment" value="${escapeHtml(storyLastCommentText(s))}" placeholder="Latest Jira comment or your PM follow-up note" /></div>
    </div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="${prefix}-contacted" ${s.contacted ? 'checked' : ''} style="width:auto;" /> Contacted?</label>
      <label style="display:flex;align-items:center;gap:6px;font-weight:normal;"><input type="checkbox" id="${prefix}-commentadded" ${s.commentAdded ? 'checked' : ''} style="width:auto;" /> Comment added?</label>
      ${s.lastCommentedAt !== undefined && s.id ? `<span class="micro" style="align-self:center;text-transform:none;">last comment: ${lastCommentLabel(s)}</span>` : ''}
    </div>`;
}

// Read the tracking-field inputs for a given prefix into a payload (only fields that exist).
function readTrackingFields(prefix) {
  const g = id => document.getElementById(`${prefix}-${id}`);
  const out = {};
  if (g('tracked')) out.tracked = g('tracked').checked;
  if (g('jira')) out.jiraId = g('jira').value.trim();
  if (g('assignee')) out.assignee = g('assignee').value.trim();
  if (g('sprint')) out.sprint = g('sprint').value.trim();
  if (g('contacted')) out.contacted = g('contacted').checked;
  if (g('commentadded')) out.commentAdded = g('commentadded').checked;
  if (g('lastcomment')) out.lastComment = g('lastcomment').value.trim();
  return out;
}

function renderStoriesPanel(project) {
  const stories = project.stories || [];
  const assigneeOptions = [...new Set(stories.map(story => storyAssignee(story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sprintFilterOptions = [...new Set(stories.map(story => storySprint(story)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const search = storySearch.trim().toLowerCase();
  const filtered = stories.filter(s => {
    if (storyStatusFilter !== 'all' && inferStatusClient(s) !== storyStatusFilter) return false;
    if (storyAssigneeFilter !== 'all' && storyAssignee(s) !== storyAssigneeFilter) return false;
    if (storySprintFilter !== 'all' && storySprint(s) !== storySprintFilter) return false;
    if (search) {
      const milestone = project.timeline.find(entry => entry.id === s.timelineId);
      const hay = [s.id, s.jiraId, s.summary, s.description, storyAssignee(s), storySprint(s), s.notes, s.dependencies, storyLastCommentText(s), inferStatusClient(s), milestone?.title, (s.labels || []).join(' ')].map(x => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const sorted = filtered.slice().sort((a, b) => {
    return statusPriority(b) - statusPriority(a) || (latestStoryActivityTime(b) || 0) - (latestStoryActivityTime(a) || 0);
  });
  const blockedCount = stories.filter(s => inferStatusClient(s) === 'Blocked').length;
  const trackedCount = stories.filter(s => s.tracked).length;
  const followupCount = stories.filter(itemNeedsFollowup).length;
  const quietCount = stories.filter(itemNeedsComment).length;
  const openStories = stories.filter(s => inferStatusClient(s) !== 'Done');
  const assigneeGapCount = openStories.filter(s => !storyAssignee(s)).length;
  const sprintGapCount = openStories.filter(s => !storySprint(s)).length;
  const commentGapCount = openStories.filter(s => !storyLastCommentText(s)).length;
  const gapImpactCount = openStories.filter(s => {
    return !storyAssignee(s) || !storySprint(s) || !storyLastCommentText(s);
  }).length;
  const activeCount = stories.filter(s => ['In progress', 'Active'].includes(inferStatusClient(s))).length;
  const doneCount = stories.filter(s => inferStatusClient(s) === 'Done').length;
  const operatingQueue = stories.slice().sort((a, b) => statusPriority(b) - statusPriority(a) || (latestStoryActivityTime(b) || 0) - (latestStoryActivityTime(a) || 0)).slice(0, 6);
  const readinessNotes = [];
  if (assigneeGapCount) readinessNotes.push(`${assigneeGapCount} work item${assigneeGapCount === 1 ? '' : 's'} have no assignee recorded.`);
  if (sprintGapCount) readinessNotes.push(`${sprintGapCount} work item${sprintGapCount === 1 ? '' : 's'} have no sprint recorded.`);
  if (commentGapCount) readinessNotes.push(`${commentGapCount} work item${commentGapCount === 1 ? '' : 's'} have no last comment or PM note recorded.`);
  if (!blockedCount && !followupCount && !quietCount) readinessNotes.push('No active blocker or follow-up signals are currently recorded.');

  const addForm = storyShowAddForm ? `
    <div class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);margin-bottom:14px;">
      <div style="margin-bottom:12px;"><strong style="color:var(--accent);">New work item</strong></div>
      <div class="form-grid">
        <div class="form-row"><label>Start from template</label>
          <select id="story-template" onchange="applyStoryTemplate(this.value)">
            <option value="">Blank work item</option>
            ${STORY_TEMPLATES.map(template => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('')}
          </select>
          <div class="micro form-help">Templates prefill wording and acceptance criteria. Review every field before creating.</div>
        </div>
        <div class="form-row"><label>Summary</label><input id="story-summary" /></div>
        <div class="form-row"><label>Description</label><textarea id="story-description"></textarea></div>
        <div class="field-row">
          <div><label>Acceptance Criteria (one per line)</label><textarea id="story-criteria"></textarea></div>
          <div><label>Dependencies</label><input id="story-dependencies" /></div>
        </div>
        <div class="field-row">
          <div><label>Labels (comma separated)</label><input id="story-labels" /></div>
          <div><label>Environment</label><input id="story-environment" /></div>
        </div>
        <div class="form-row"><label>Notes</label><textarea id="story-notes"></textarea></div>
        <div class="form-row"><label>Link to timeline</label>
          <select id="story-timeline">
            <option value="">None</option>
            ${project.timeline.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)} (${escapeHtml(t.date || 'no date')})</option>`).join('')}
          </select>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:2px;">
          <div class="micro" style="margin-bottom:8px;">Follow-up tracking (optional)</div>
          ${trackingFieldsHtml('story', {}, true)}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="button" onclick="createStory()">Create Work Item</button>
          <button class="button secondary" onclick="toggleStoryAddForm()">Cancel</button>
        </div>
      </div>
    </div>` : '';

  const importPreview = storyImportPreview;
  const previewRows = importPreview?.items?.slice(0, 8) || [];
  const importForm = storyShowImportForm ? `
    <div class="card csv-import-card">
      <div class="section-heading">
        <div>
          <h4>Import work items from CSV</h4>
          <p class="csv-import-description">Preview the file first. Importing stays local, skips duplicate Jira keys, and does not turn on follow-up tracking.</p>
        </div>
        <button class="button button-small secondary" onclick="cancelStoryCsvImport()">Close</button>
      </div>
      ${storyImportError ? `<div class="note warn" style="margin:0 0 12px;">${escapeHtml(storyImportError)}</div>` : ''}
      ${!importPreview ? `
        <div class="csv-import-controls">
          <label class="csv-import-dropzone" id="csv-import-dropzone" onclick="document.getElementById('story-import-file').click()" ondragover="csvImportDragOver(event)" ondragleave="csvImportDragLeave(event)" ondrop="csvImportDrop(event)">
            <strong id="csv-import-file-label">Drop one CSV here, or browse</strong>
            <span class="micro">Recognized fields include Issue Key, Summary, Status, Assignee, Sprint, Labels, Comments, and more. Summary is required.</span>
          </label>
          <input id="story-import-file" type="file" accept=".csv,text/csv" style="display:none;" onchange="csvImportFileChosen()" />
          <button class="button" onclick="previewStoryCsvImport()" ${storyImportLoading ? 'disabled' : ''}>${storyImportLoading ? 'Reading CSV...' : 'Preview import'}</button>
        </div>` : `
        <div class="csv-import-summary">
          <div><span class="micro">File</span><strong>${escapeHtml(importPreview.fileName || 'Selected CSV')}</strong></div>
          <div><span class="micro">Ready to add</span><strong>${importPreview.items.length} work item${importPreview.items.length === 1 ? '' : 's'}</strong></div>
          <div><span class="micro">Skipped</span><strong>${importPreview.skipped.length}</strong></div>
          <div><span class="micro">Recognized</span><strong>${escapeHtml((importPreview.columns || []).join(', ') || 'Summary')}</strong></div>
        </div>
        ${previewRows.length ? `<div class="csv-import-preview">
          <div class="micro" style="margin-bottom:7px;">Previewing the first ${previewRows.length} item${previewRows.length === 1 ? '' : 's'}</div>
          ${previewRows.map(item => `<div class="csv-import-row">
            <div><strong>${escapeHtml(item.summary)}</strong><div class="micro">${item.jiraId ? escapeHtml(item.jiraId) : 'No Jira key'}${item.assignee ? ` · ${escapeHtml(item.assignee)}` : ''}${item.sprint ? ` · ${escapeHtml(item.sprint)}` : ''}</div></div>
            ${statusBadge(inferStatusClient(item))}
          </div>`).join('')}
        </div>` : '<div class="note warn" style="margin:12px 0;">No new work items were recognized in this file.</div>'}
        ${importPreview.skipped.length ? `<div class="csv-import-skipped"><strong>${importPreview.skipped.length} row${importPreview.skipped.length === 1 ? '' : 's'} skipped</strong><span>${escapeHtml(importPreview.skipped.slice(0, 4).map(item => `Row ${item.row}: ${item.reason}`).join(' | '))}${importPreview.skipped.length > 4 ? ' | More rows omitted' : ''}</span></div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
          <button class="button" onclick="confirmStoryCsvImport()" ${!importPreview.items.length || storyImportLoading ? 'disabled' : ''}>${storyImportLoading ? 'Importing...' : `Import ${importPreview.items.length} work item${importPreview.items.length === 1 ? '' : 's'}`}</button>
          <button class="button secondary" onclick="resetStoryCsvImport()">Choose another file</button>
        </div>`}
    </div>` : '';

  const queueHtml = operatingQueue.length ? `
    <div class="stack">
      ${operatingQueue.map(story => {
        const attention = workItemAttentionProfile(story, project);
        return `
          <div class="surface-row">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
              <div style="min-width:0;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  ${story.jiraId ? `<span class="mono" style="color:var(--accent);font-size:0.78rem;">${escapeHtml(story.jiraId)}</span>` : ''}
                  <strong>${escapeHtml(story.summary)}</strong>
                  ${statusBadge(inferStatusClient(story))}
                </div>
                <p style="margin:4px 0 0;">${escapeHtml(attention.detail)}</p>
                <div class="micro" style="margin-top:6px;text-transform:none;">${storyAssignee(story) ? `assignee ${escapeHtml(storyAssignee(story))} · ` : ''}${storySprint(story) ? `sprint ${escapeHtml(storySprint(story))} · ` : ''}last comment ${escapeHtml(lastCommentLabel(story))}</div>
              </div>
              <span class="badge ${attention.badge}">${escapeHtml(attention.label)}</span>
            </div>
          </div>`;
      }).join('')}
    </div>` : '<p>No work items yet. Add the first one to start using this project as your operating queue.</p>';

  const listBody = sorted.length ? `
    <ul class="panel-list">
      ${sorted.map(story => storyEditing === story.id ? renderStoryEditForm(project, story) : renderWorkItemListRow(project, story)).join('')}
    </ul>` : `<div class="card"><p>${stories.length ? 'No work items match the filter.' : 'No work items yet — use “+ New work item”.'}</p></div>`;

  return `
    <div class="card hero-card screen-lead work-items-lead" style="margin-bottom:14px;">
      <div class="micro" style="margin-bottom:8px;">Operational work queue</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:260px;">
          <h3 style="margin:0 0 8px;">${escapeHtml(selectedProject)} work items</h3>
          <p style="margin:0;">This screen is tuned for daily triage: blocked work, follow-up risk, ownership gaps, and evidence gaps surface first so your leadership summary stays grounded in what is actually recorded.</p>
        </div>
        <div class="hero-actions">
          <button class="button" onclick="toggleStoryAddForm()">+ New work item</button>
          <button class="button secondary" onclick="toggleStoryImportForm()">Import CSV</button>
          <button class="button secondary" onclick="openFollowUp()">Open follow-up</button>
          <button class="button secondary" onclick="openStatusSummary()">Open status summary</button>
        </div>
      </div>
    </div>
    ${renderWorkTabs('stories')}
    <div class="insight-strip operating-metrics work-items-metrics" style="margin-bottom:14px;">
      <div class="insight-tile">
        <div class="micro">Blocked</div>
        <div class="insight-number">${blockedCount}</div>
        <div class="insight-copy">${activeCount} active/in progress · ${doneCount} done</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Follow-Up Risk</div>
        <div class="insight-number">${followupCount + quietCount}</div>
        <div class="insight-copy">${followupCount} need contact · ${quietCount} quiet threads</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Coverage Gaps</div>
        <div class="insight-number">${gapImpactCount}</div>
        <div class="insight-copy">${assigneeGapCount} assignee gaps · ${sprintGapCount} sprint gaps · ${commentGapCount} comment gaps</div>
      </div>
      <div class="insight-tile">
        <div class="micro">Current View</div>
        <div class="insight-number">${sorted.length}</div>
        <div class="insight-copy">${stories.length} total work items in this project</div>
      </div>
    </div>
    <div class="section-grid" style="margin-bottom:14px;">
      <div class="card">
        <div class="section-heading">
          <h4>Operating Queue</h4>
          <span class="micro">what needs attention first</span>
        </div>
        <p style="margin:0 0 8px;">This queue ignores optimism and sorts for operational importance first.</p>
        ${queueHtml}
      </div>
      <div class="card">
        <div class="section-heading">
          <h4>Readiness Gaps</h4>
          <span class="micro">what weakens leadership reporting</span>
        </div>
        ${readinessNotes.length
          ? `<div class="stack">${readinessNotes.map((note, index) => `<div class="surface-row"${index === readinessNotes.length - 1 ? ' style="padding-bottom:0;border-bottom:none;"' : ''}><p>${escapeHtml(note)}</p></div>`).join('')}</div>`
          : '<p>No obvious readiness gaps are visible in the saved work-item data.</p>'}
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button secondary" onclick="openCapture()">Capture evidence</button>
          <button class="button secondary" onclick="openMilestones()">Review milestones</button>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <select onchange="setStoryFilter(this.value)" style="width:auto;">
          <option value="all" ${storyStatusFilter === 'all' ? 'selected' : ''}>All statuses</option>
          <option value="Done" ${storyStatusFilter === 'Done' ? 'selected' : ''}>Done</option>
          <option value="In progress" ${storyStatusFilter === 'In progress' ? 'selected' : ''}>In progress</option>
          <option value="Active" ${storyStatusFilter === 'Active' ? 'selected' : ''}>Active</option>
          <option value="Blocked" ${storyStatusFilter === 'Blocked' ? 'selected' : ''}>Blocked</option>
          <option value="Planned" ${storyStatusFilter === 'Planned' ? 'selected' : ''}>Planned</option>
          <option value="Not started" ${storyStatusFilter === 'Not started' ? 'selected' : ''}>Not started</option>
        </select>
        <select onchange="setStoryAssigneeFilter(this.value)" style="width:auto;max-width:190px;">
          <option value="all" ${storyAssigneeFilter === 'all' ? 'selected' : ''}>All assignees</option>
          ${assigneeOptions.map(value => `<option value="${escapeHtml(value)}" ${storyAssigneeFilter === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select>
        <select onchange="setStorySprintFilter(this.value)" style="width:auto;max-width:190px;">
          <option value="all" ${storySprintFilter === 'all' ? 'selected' : ''}>All sprints</option>
          ${sprintFilterOptions.map(value => `<option value="${escapeHtml(value)}" ${storySprintFilter === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select>
        <input id="story-search" value="${escapeHtml(storySearch)}" placeholder="Search jira, assignee, sprint, notes, labels…" oninput="setStorySearch(this.value)" style="width:260px;" />
      </div>
      <div class="micro">${sorted.length} shown · ${trackedCount} tracked for follow-up</div>
    </div>
    <div class="note warn" style="margin-bottom:14px;">Priority order: blocked work, assignee follow-up risk, quiet Jira threads, then latest recorded activity.</div>
    ${addForm}
    ${importForm}
    ${listBody}
  `;
}

function setStoryFilter(value) {
  storyStatusFilter = value;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}
function setStoryAssigneeFilter(value) {
  storyAssigneeFilter = value;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}
function setStorySprintFilter(value) {
  storySprintFilter = value;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}
function setStorySearch(value) {
  storySearch = value;
  if (!selectedProject) return;
  storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
  const el = document.getElementById('story-search');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
function toggleStoryAddForm() {
  storyShowAddForm = !storyShowAddForm;
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
  if (storyShowAddForm) { const el = document.getElementById('story-summary'); if (el) el.focus(); }
}

function renderStoriesAfterCsvChange() {
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}

function toggleStoryImportForm() {
  storyShowImportForm = !storyShowImportForm;
  storyImportPreview = null;
  storyImportError = '';
  storyImportLoading = false;
  renderStoriesAfterCsvChange();
  if (storyShowImportForm) {
    const input = document.getElementById('story-import-file');
    if (input) input.focus();
  }
}

function resetStoryCsvImport() {
  storyImportPreview = null;
  storyImportError = '';
  storyImportLoading = false;
  renderStoriesAfterCsvChange();
}

function csvImportDragOver(event) {
  event.preventDefault();
  document.getElementById('csv-import-dropzone')?.classList.add('dragover');
}

function csvImportDragLeave(event) {
  event.preventDefault();
  document.getElementById('csv-import-dropzone')?.classList.remove('dragover');
}

function csvImportFileChosen() {
  const file = document.getElementById('story-import-file')?.files?.[0];
  const label = document.getElementById('csv-import-file-label');
  if (file && label) label.textContent = `Selected: ${file.name}`;
}

function csvImportDrop(event) {
  event.preventDefault();
  document.getElementById('csv-import-dropzone')?.classList.remove('dragover');
  if ((event.dataTransfer?.files?.length || 0) !== 1) {
    storyImportError = 'Drop one CSV file at a time.';
    renderStoriesAfterCsvChange();
    return;
  }
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    storyImportError = 'Drop a .csv file to import work items.';
    renderStoriesAfterCsvChange();
    return;
  }
  const input = document.getElementById('story-import-file');
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  } catch (_) {
    storyImportError = 'Your browser could not read the dropped file. Use Browse instead.';
    renderStoriesAfterCsvChange();
    return;
  }
  csvImportFileChosen();
}

function cancelStoryCsvImport() {
  storyShowImportForm = false;
  storyImportPreview = null;
  storyImportError = '';
  storyImportLoading = false;
  renderStoriesAfterCsvChange();
}

async function previewStoryCsvImport() {
  const file = document.getElementById('story-import-file')?.files?.[0];
  if (!file) {
    storyImportError = 'Choose a CSV file to preview.';
    renderStoriesAfterCsvChange();
    return;
  }
  storyImportLoading = true;
  storyImportError = '';
  renderStoriesAfterCsvChange();
  try {
    const form = new FormData();
    form.append('project', selectedProject);
    form.append('file', file);
    const response = await fetch('/api/project/story/import/preview', { method: 'POST', body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to preview this CSV');
    storyImportPreview = result;
  } catch (error) {
    storyImportError = error.message || 'Unable to preview this CSV';
  } finally {
    storyImportLoading = false;
    renderStoriesAfterCsvChange();
  }
}

async function confirmStoryCsvImport() {
  if (!storyImportPreview?.items?.length) return;
  storyImportLoading = true;
  storyImportError = '';
  renderStoriesAfterCsvChange();
  try {
    const response = await fetch('/api/project/story/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: selectedProject, items: storyImportPreview.items })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to import this CSV');
    storyShowImportForm = false;
    storyImportPreview = null;
    await refreshProject();
    alert(`${result.created} work item${result.created === 1 ? '' : 's'} imported${result.skipped?.length ? `; ${result.skipped.length} skipped` : ''}.`);
  } catch (error) {
    storyImportError = error.message || 'Unable to import this CSV';
    storyImportLoading = false;
    renderStoriesAfterCsvChange();
  }
}

function applyStoryTemplate(templateId) {
  const template = STORY_TEMPLATES.find(item => item.id === templateId);
  if (!template) return;
  const fill = (id, value) => {
    const element = document.getElementById(id);
    if (element && !element.value.trim()) element.value = value;
  };
  fill('story-description', template.description);
  fill('story-criteria', template.acceptanceCriteria.join('\n'));
  fill('story-labels', template.labels);
  const summary = document.getElementById('story-summary');
  if (summary) summary.focus();
}

function toggleWorkItemExpanded(id) {
  if (workItemExpanded.has(id)) workItemExpanded.delete(id);
  else workItemExpanded.add(id);
  if (selectedProject) storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);
}

function toggleTrackingExpanded(project, id) {
  const key = `${project}::${id}`;
  if (trackingExpanded.has(key)) trackingExpanded.delete(key);
  else trackingExpanded.add(key);
  trackingPanel.innerHTML = renderTrackingPanel();
}

// Flip a story's "tracked" flag — adds/removes it from the cross-project Tracking view.
async function toggleStoryTracked(project, id, tracked) {
  const response = await saveRequest('/api/project/story', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, id, tracked: !!tracked })
  });
  if (!response) return;
  await refreshProject();
}

function renderStoryEditForm(project, story) {
  const ac = Array.isArray(story.acceptanceCriteria) ? story.acceptanceCriteria.join('\n') : '';
  const labels = Array.isArray(story.labels) ? story.labels.join(', ') : '';
  return `
    <li class="card" style="border-color:var(--accent);box-shadow:0 0 0 3px rgba(58,111,214,0.12);">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px;">
        <span class="mono" style="color:var(--muted-2);font-size:0.8rem;">${escapeHtml(story.id)}</span>
        <strong style="color:var(--accent);">Editing · all fields</strong>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>Summary</label><input id="edit-story-summary" value="${escapeHtml(story.summary || '')}" /></div>
        <div class="form-row"><label>Description</label><textarea id="edit-story-description">${escapeHtml(story.description || '')}</textarea></div>
        <div class="field-row">
          <div><label>Acceptance Criteria (one per line)</label><textarea id="edit-story-criteria">${escapeHtml(ac)}</textarea></div>
          <div><label>Dependencies</label><input id="edit-story-dependencies" value="${escapeHtml(story.dependencies || '')}" /></div>
        </div>
        <div class="field-row">
          <div><label>Labels (comma separated)</label><input id="edit-story-labels" value="${escapeHtml(labels)}" /></div>
          <div><label>Environment</label><input id="edit-story-environment" value="${escapeHtml(story.environment || '')}" /></div>
        </div>
        <div class="form-row"><label>Notes</label><textarea id="edit-story-notes">${escapeHtml(story.notes || '')}</textarea></div>
        <div class="form-row"><label>Link to timeline</label>
          <select id="edit-story-timeline">
            <option value="">None</option>
            ${project.timeline.map(t => `<option value="${escapeHtml(t.id)}" ${story.timelineId === t.id ? 'selected' : ''}>${escapeHtml(t.title)} (${escapeHtml(t.date || 'no date')})</option>`).join('')}
          </select>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:2px;">
          <div class="micro" style="margin-bottom:8px;">Follow-up tracking</div>
          ${trackingFieldsHtml('edit-story', story, true)}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="button" onclick="saveStoryEdit(${eventArg(story.id)})">Save</button>
          <button class="button secondary" onclick="cancelStoryEdit()">Cancel</button>
        </div>
      </div>
    </li>`;
}

function startStoryEdit(id) {
  storyEditing = id;
  workItemExpanded.add(id);
  renderPanels();
}

function cancelStoryEdit() {
  storyEditing = null;
  renderPanels();
}

async function saveStoryEdit(id) {
  const val = elementId => { const el = document.getElementById(elementId); return el ? el.value : undefined; };
  const payload = {
    project: selectedProject,
    id,
    summary: val('edit-story-summary'),
    description: val('edit-story-description'),
    acceptanceCriteria: val('edit-story-criteria'),
    dependencies: val('edit-story-dependencies'),
    labels: val('edit-story-labels'),
    environment: val('edit-story-environment'),
    notes: val('edit-story-notes'),
    timelineId: val('edit-story-timeline'),
    ...readTrackingFields('edit-story')
  };
  const response = await saveRequest('/api/project/story', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response) return;
  storyEditing = null;
  await refreshProject();
}

async function createStory() {
  const summary = document.getElementById('story-summary').value.trim();
  const description = document.getElementById('story-description').value.trim();
  const acceptanceCriteria = document.getElementById('story-criteria').value.trim().split('\n');
  const dependencies = document.getElementById('story-dependencies').value.trim();
  const labels = document.getElementById('story-labels').value.trim();
  const environment = document.getElementById('story-environment').value.trim();
  const notes = document.getElementById('story-notes').value.trim();

  if (!summary || !selectedProject) {
    alert('Please select a project and enter a summary.');
    return;
  }

  const response = await saveRequest('/api/project/story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: selectedProject,
      summary,
      description,
      acceptanceCriteria,
      dependencies,
      labels,
      environment,
      notes,
      timelineId: document.getElementById('story-timeline') ? document.getElementById('story-timeline').value : '',
      ...readTrackingFields('story')
    })
  });
  if (!response) return;

  storyShowAddForm = false;
  await refreshProject();
}

async function createTimeline() {
  const project = document.getElementById('timeline-project-select')?.value || selectedProject;
  const title = document.getElementById('timeline-title').value.trim();
  const date = document.getElementById('timeline-date').value;
  const status = document.getElementById('timeline-status').value.trim();
  const notes = document.getElementById('timeline-notes').value.trim();

  if (!title || !project) {
    alert('Please select a project and enter a title.');
    return;
  }

  const response = await saveRequest('/api/project/timeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project,
      title,
      date,
      status,
      notes
    })
  });
  if (!response) return;

  await fetchProjects();
  if (project !== selectedProject) {
    selectProject(project);
  }
}

async function saveStructuredMeeting() {
  if (!selectedProject) return;
  const value = id => document.getElementById(id)?.value.trim() || '';
  const title = value('meeting-title');
  const summary = value('meeting-summary');
  if (!title || !summary) {
    alert('Enter a meeting title and factual meeting notes before saving.');
    return;
  }

  const sections = [
    `Attendees: ${value('meeting-attendees') || 'Not recorded'}`,
    `Discussion:\n${summary}`,
    value('meeting-decisions') ? `Decisions:\n${value('meeting-decisions')}` : '',
    value('meeting-actions') ? `Actions and owners:\n${value('meeting-actions')}` : ''
  ].filter(Boolean);
  const formData = new FormData();
  formData.append('project', selectedProject);
  formData.append('title', title);
  formData.append('date', document.getElementById('meeting-date')?.value || '');
  formData.append('type', document.getElementById('meeting-type')?.value || 'Meeting');
  formData.append('notes', sections.join('\n\n'));

  const response = await fetch('/api/project/transcript', { method: 'POST', body: formData });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unable to save meeting note' }));
    alert(error.error || 'Unable to save meeting note');
    return;
  }
  captureFocus = '';
  await refreshProject();
}

async function uploadTranscript() {
  const notes = document.getElementById('transcript-notes')?.value.trim() || '';
  const fileInput = document.getElementById('transcript-file');

  if (!captureSelectedFiles.length || !selectedProject) {
    alert('Choose one to five files, then set the type for each source.');
    return;
  }
  if (captureSelectedFiles.length > 5) { alert('Upload up to five files at a time.'); return; }

  const formData = new FormData();
  formData.append('project', selectedProject);
  formData.append('notes', notes);
  formData.append('metadata', JSON.stringify(captureSelectedFiles.map(item => ({ title: item.title.trim() || item.file.name, type: item.type }))));
  captureSelectedFiles.forEach(item => formData.append('files', item.file));

  const response = await fetch('/api/project/transcript', {
    method: 'POST',
    body: formData
  });
  const result = await response.json().catch(() => ({ error: 'Unable to upload sources' }));
  if (!response.ok) { alert(result.error || 'Unable to upload sources'); return; }

  if (fileInput) fileInput.value = '';
  const warnings = result.warnings || [];
  const uploaded = result.transcripts ? result.transcripts.length : 1;
  captureSelectedFiles = [];
  captureUploadFeedback = {
    warning: warnings.length > 0,
    message: `${uploaded} source${uploaded === 1 ? '' : 's'} saved.${warnings.length ? ` ${warnings.join(' | ')}` : ''}`
  };
  await refreshProject();
}

// Activate a screen by name. Both the sidebar nav items and the header help (?) icon route
// here — Help lives on the icon, not in the nav, so no nav item matches it.
function activateTab(tab) {
  currentTab = tab;
  navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  helpButton.classList.toggle('active', tab === 'help');
  updateHeader();
  overviewPanel.classList.toggle('active-panel', tab === 'overview');
  portfolioPanel.classList.toggle('active-panel', tab === 'portfolio');
  storiesPanel.classList.toggle('active-panel', tab === 'stories');
  trackingPanel.classList.toggle('active-panel', tab === 'tracking');
  timelinePanel.classList.toggle('active-panel', tab === 'timeline');
  transcriptsPanel.classList.toggle('active-panel', tab === 'transcripts');
  reportsPanel.classList.toggle('active-panel', tab === 'reports');
  teamsPanel.classList.toggle('active-panel', tab === 'teams');
  managePanel.classList.toggle('active-panel', tab === 'manage');
  helpPanel.classList.toggle('active-panel', tab === 'help');
}

function toggleLinkStoryForm(timelineId) {
  const form = document.getElementById(`link-form-${timelineId}`);
  if (form) {
    form.classList.toggle('hidden');
  }
}

async function submitLinkStory(timelineId) {
  const storyId = document.getElementById(`timeline-story-select-${timelineId}`)?.value;
  if (!storyId) {
    alert('Select a work item to link.');
    return;
  }

  const response = await saveRequest('/api/project/story/link', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: selectedProject, storyId, timelineId })
  });
  if (!response) return;

  await refreshProject();
}

function startStoryFromTimeline(timelineId) {
  if (!selectedProject) {
    alert('Select a project first.');
    return;
  }

  // Open the Work Items screen with the new-item form expanded, then pre-fill from the milestone.
  storyShowAddForm = true;
  activateTab('stories');
  storiesPanel.innerHTML = renderStoriesPanel(projects[selectedProject]);

  setTimeout(() => {
    const storyTimeline = document.getElementById('story-timeline');
    const storySummary = document.getElementById('story-summary');
    const timelineItem = (projects[selectedProject].timeline || []).find(t => t.id === timelineId);
    if (storyTimeline) storyTimeline.value = timelineId;
    if (storySummary) {
      storySummary.value = timelineItem ? timelineItem.title : '';
      storySummary.focus();
    }
  }, 40);
}

navButtons.forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
quickCaptureButton.addEventListener('click', () => openCapture('meeting'));
helpButton.addEventListener('click', () => activateTab('help'));

// Sidebar collapse/expand
function initSidebarToggle() {
  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
  if (sidebarCollapsed) {
    appElement.classList.add('sidebar-collapsed');
    sidebarToggle.setAttribute('title', 'Expand sidebar');
    sidebarToggle.setAttribute('aria-label', 'Expand sidebar');
  }
}

function toggleSidebar() {
  appElement.classList.toggle('sidebar-collapsed');
  const isCollapsed = appElement.classList.contains('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', isCollapsed);
  sidebarToggle.setAttribute('title', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
  sidebarToggle.setAttribute('aria-label', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

sidebarToggle.addEventListener('click', toggleSidebar);
initSidebarToggle();

fetchProjects();
