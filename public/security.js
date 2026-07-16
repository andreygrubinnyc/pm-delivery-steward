(function exposeSecurityUtilities(root, factory) {
  const utilities = factory();
  if (typeof module === 'object' && module.exports) module.exports = utilities;
  if (root) root.PMSecurity = utilities;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function csvCell(value) {
    let text = String(value == null ? '' : value);
    if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function markdownCell(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/([\[\]!`*_{}#~])/g, '\\$1')
      .replace(/[\r\n]+/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function isAllowedHost(hostHeader) {
    const hostname = String(hostHeader || '').replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost';
  }

  function isTrustedMutationRequest({ method, host, origin, fetchSite }) {
    if (!isAllowedHost(host)) return false;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase())) return true;
    if (String(fetchSite || '').toLowerCase() === 'cross-site') return false;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === 'http:' && parsed.host.toLowerCase() === String(host).toLowerCase();
    } catch (_) {
      return false;
    }
  }

  function normalizeStatusValue(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function operatingStatusFromValue(value) {
    const normalized = normalizeStatusValue(value);
    const statuses = {
      done: 'Done',
      complete: 'Done',
      completed: 'Done',
      resolved: 'Done',
      closed: 'Done',
      'in progress': 'In progress',
      ongoing: 'In progress',
      blocked: 'Blocked',
      'on hold': 'Blocked',
      active: 'Active',
      planned: 'Planned',
      'to do': 'Planned',
      todo: 'Planned',
      backlog: 'Planned',
      open: 'Planned',
      'not started': 'Not started'
    };
    return statuses[normalized] || '';
  }

  function operatingStatusFromLabels(labels) {
    const values = Array.isArray(labels) ? labels : [labels];
    for (const value of values) {
      const normalized = normalizeStatusValue(value);
      if (!normalized || normalized.startsWith('original status:')) continue;
      const status = operatingStatusFromValue(value);
      if (status) return status;
    }
    return '';
  }

  function daysSinceIso(value, nowMs = Date.now(), allowedFutureSkewMs = 5 * 60 * 1000) {
    if (!value) return null;
    const then = new Date(value).getTime();
    if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return null;
    if (then > nowMs + allowedFutureSkewMs) return null;
    return Math.max(0, Math.floor((nowMs - then) / 86400000));
  }

  function dateOnlyParts(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) return null;
    return parts;
  }

  function parseLocalDateOnly(value) {
    const parts = dateOnlyParts(value);
    return parts ? new Date(parts.year, parts.month - 1, parts.day) : null;
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function calendarDayDelta(targetValue, todayValue) {
    const target = dateOnlyParts(targetValue);
    const today = dateOnlyParts(todayValue);
    if (!target || !today) return null;
    const targetUtc = Date.UTC(target.year, target.month - 1, target.day);
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
    return Math.round((targetUtc - todayUtc) / 86400000);
  }

  function daysUntilDateOnly(value, now = new Date()) {
    return calendarDayDelta(value, localDateKey(now));
  }

  function safeTranscriptUrl(value) {
    const text = String(value || '');
    return /^\/uploads\/transcripts\/[a-f0-9]{32}$/i.test(text) ? text : '';
  }

  return {
    csvCell,
    markdownCell,
    isAllowedHost,
    isTrustedMutationRequest,
    operatingStatusFromValue,
    operatingStatusFromLabels,
    daysSinceIso,
    parseLocalDateOnly,
    localDateKey,
    calendarDayDelta,
    daysUntilDateOnly,
    safeTranscriptUrl
  };
}));
