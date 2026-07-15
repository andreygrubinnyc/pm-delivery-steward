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
      .replace(/[\r\n]+/g, ' ');
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

  return { csvCell, markdownCell, isAllowedHost, isTrustedMutationRequest };
}));
