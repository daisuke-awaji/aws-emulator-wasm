// The AWS build: the API is the Lambda Web Function at VITE_API_URL, and every request
// carries the access token of a user signed in with Cognito (authorization code + PKCE,
// through oidc-client-ts). Tokens stay in sessionStorage, for this tab only.
import { UserManager } from 'oidc-client-ts';
import { configureAuth } from './api-client.js';
import { API_URL } from './target.js';

const env = import.meta.env;
const missing = ['VITE_COGNITO_AUTHORITY', 'VITE_COGNITO_CLIENT_ID', 'VITE_COGNITO_DOMAIN'].filter((k) => !env[k]);

/** This page without query or hash: where Cognito sends the user back. */
const pageUrl = () => new URL(import.meta.env.BASE_URL, location.origin).href;

const listeners = new Set();
const live = {
  user: undefined,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
const update = (user) => {
  live.user = user;
  for (const fn of listeners) fn();
};

export function start() {
  if (missing.length) {
    return { target: 'aws', apiUrl: API_URL, live, ready: Promise.reject(new Error(`${missing.join(', ')} not set for the AWS build`)) };
  }
  const manager = new UserManager({
    authority: env.VITE_COGNITO_AUTHORITY,
    client_id: env.VITE_COGNITO_CLIENT_ID,
    redirect_uri: pageUrl(),
    response_type: 'code',
    scope: 'openid email',
    // Renew with the refresh token before the access token expires.
    automaticSilentRenew: true,
  });
  manager.events.addUserLoaded(update);
  manager.events.addUserUnloaded(() => update(undefined));

  const signIn = () => manager.signinRedirect();
  configureAuth({
    token: async () => (await manager.getUser())?.access_token,
    unauthorized: () => manager.removeUser(),
  });

  const ready = (async () => {
    const params = new URLSearchParams(location.search);
    if (params.has('code') || params.has('error')) {
      // Back from the Cognito sign-in page: trade the code for tokens. A code that is stale,
      // already used, or whose state this tab lost leaves the user signed out, with a clean
      // URL, so that the sign-in button works and a reload does not fail the same way.
      try {
        await manager.signinCallback();
      } catch (error) {
        console.warn('sign-in callback failed', error);
        await manager.clearStaleState().catch(() => {});
      }
      history.replaceState(null, '', pageUrl());
    }
    let user = await manager.getUser();
    if (user?.expired) user = await manager.signinSilent().catch(() => null);
    update(user ?? undefined);
    return { user: user ?? undefined };
  })();

  return {
    target: 'aws',
    apiUrl: API_URL,
    ready,
    live,
    signIn,
    /** Forgets the tokens here, then ends the Cognito session (it has no OIDC end-session endpoint). */
    async signOut() {
      await manager.removeUser();
      const url = new URL('/logout', env.VITE_COGNITO_DOMAIN);
      url.searchParams.set('client_id', env.VITE_COGNITO_CLIENT_ID);
      url.searchParams.set('logout_uri', pageUrl());
      location.assign(url);
    },
  };
}
