import { useEffect, useState } from 'react';

export type Route =
  | { page: 'studio'; openNew: boolean }
  | { page: 'channel'; id: number }
  | { page: 'videos'; channel: number | null }
  | { page: 'activity' }
  | { page: 'settings' };

const isNumeric = (s: string | null | undefined): s is string => !!s && /^\d+$/.test(s);

/** Hash routes: #/, #/channel/:id, #/videos?channel=:id, #/activity, #/settings. Unknown means Studio. */
export function parseHash(hash: string): Route {
  const [pathPart = '', query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const [first, second] = pathPart.split('/').filter(Boolean);
  if (first === 'channel' && isNumeric(second)) return { page: 'channel', id: Number(second) };
  if (first === 'videos') {
    const channel = params.get('channel');
    return { page: 'videos', channel: isNumeric(channel) ? Number(channel) : null };
  }
  if (first === 'activity') return { page: 'activity' };
  if (first === 'settings') return { page: 'settings' };
  return { page: 'studio', openNew: params.get('new') === '1' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(hash: string): void {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}
