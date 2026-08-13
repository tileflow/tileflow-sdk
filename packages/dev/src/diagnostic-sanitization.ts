export function sanitizeDiagnosticSecrets(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\btf_(?:live|cli|test)_[A-Za-z0-9_-]{8,}\b/gi, 'tf_[redacted]')
    .replace(/\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(
      /([?&](?:access_token|api_key|key|password|secret|signature|token)=)[^&#\s]+/gi,
      '$1[redacted]',
    );
}
