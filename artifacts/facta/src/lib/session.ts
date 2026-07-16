export function getSessionId(): string {
  let sessionId = localStorage.getItem('facta_session');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem('facta_session', sessionId);
  }
  return sessionId;
}

export function isAdmin(): boolean {
  return localStorage.getItem('facta_admin') === 'true';
}
