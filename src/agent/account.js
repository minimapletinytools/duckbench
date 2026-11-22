import {AuthClient} from '@supabase/auth-js';
import defaults from './config.json';

export async function createAccount(onSession) {
  const desktop = window.desktop;
  const config = desktop ? await desktop.agentConfig() : {
    backend: import.meta.env.VITE_KIGUMI_BACKEND_URL || defaults.backend,
    supabase: import.meta.env.VITE_KIGUMI_SUPABASE_URL || defaults.supabase,
    key: import.meta.env.VITE_KIGUMI_SUPABASE_KEY || defaults.key,
  };
  const auth = new AuthClient({
    url: config.supabase.replace(/\/$/, '') + '/auth/v1',
    headers: {apikey: config.key, Authorization: 'Bearer ' + config.key},
    storageKey: 'duckbench.auth.' + new URL(config.supabase).host,
    flowType: 'pkce', persistSession: !desktop, detectSessionInUrl: false, autoRefreshToken: true,
  });
  auth.onAuthStateChange((_event, session) => onSession(session?.user || null));
  async function request(path, {method = 'GET', body, signal, token, keepalive = false} = {}) {
    const headers = {};
    if (token === undefined && path !== '/models') {
      const {data, error} = await auth.getSession();
      if (error || !data.session) throw new Error('Sign in to connect.');
      token = data.session.access_token;
    }
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const init = {method, headers, body: body === undefined ? undefined : JSON.stringify(body)};
    signal?.throwIfAborted();
    let status, data;
    if (desktop) {
      const id = crypto.randomUUID();
      const abort = () => { void desktop.abortAgentRequest(id); };
      signal?.addEventListener('abort', abort, {once: true});
      try { ({status, data} = await desktop.agentRequest(id, path, init)); }
      finally { signal?.removeEventListener('abort', abort); }
    } else {
      const response = await fetch(config.backend.replace(/\/$/, '') + path, {...init, signal, keepalive});
      status = response.status;
      data = await response.json().catch(() => null);
    }
    signal?.throwIfAborted();
    if (status < 200 || status >= 300) {
      const reason = data?.error?.message || data?.error || ('Backend returned HTTP ' + status);
      throw Object.assign(new Error(String(reason)), {status});
    }
    return data;
  }

  async function complete(url) {
    const query = new URL(url).searchParams;
    if (query.has('error')) throw new Error(query.get('error_description') || query.get('error'));
    const {error} = await auth.exchangeCodeForSession(query.get('code'));
    if (error) throw error;
  }
  return {
    request, backend: config.backend,
    async finishRedirect() {
      const url = new URL(location.href);
      if (desktop || !(url.searchParams.has('code') || url.searchParams.has('error'))) return;
      try { await complete(url); }
      finally {
        for (const key of ['code','error','error_code','error_description']) url.searchParams.delete(key);
        history.replaceState(null, '', url);
      }
    },
    async signIn(provider) {
      const redirectTo = desktop ? 'http://127.0.0.1:43781/auth/callback' : location.origin + location.pathname;
      const {data, error} = await auth.signInWithOAuth({provider, options: {redirectTo, skipBrowserRedirect: true}});
      if (error) throw error;
      if (desktop) await complete(await desktop.authorize(data.url));
      else location.assign(data.url);
    },
    async signOut() {
      const {error} = await auth.signOut({scope: 'local'});
      if (error) throw error;
    },
  };
}
