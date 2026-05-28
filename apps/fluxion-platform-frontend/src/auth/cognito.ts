import {
  CognitoUser,
  CognitoUserPool,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import { env } from "@/env";

const pool = new CognitoUserPool({
  UserPoolId: env.userPoolId,
  ClientId: env.userPoolClientId,
});

export interface CognitoSession {
  idToken: string;
  username: string;
  email: string;
}

// getSession's callback fires sync ONLY when the cached tokens are still
// valid. When the access token has expired (default 1h), it triggers a
// refresh-token round-trip, which is async — so treat the whole thing as a
// promise. Earlier sync-assuming code caused spurious logouts after ~1h.
export function currentSession(): Promise<CognitoSession | null> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) { resolve(null); return; }
      const payload = session.getIdToken().decodePayload();
      resolve({
        idToken: session.getIdToken().getJwtToken(),
        username: user.getUsername(),
        email: (payload.email as string | undefined) ?? user.getUsername(),
      });
    });
  });
}

export function signIn(username: string, password: string): Promise<CognitoSession> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: username, Pool: pool });
    const details = new AuthenticationDetails({ Username: username, Password: password });
    user.authenticateUser(details, {
      onSuccess: (session) => {
        const payload = session.getIdToken().decodePayload();
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          username: user.getUsername(),
          email: (payload.email as string | undefined) ?? user.getUsername(),
        });
      },
      onFailure: (err: Error) => reject(err),
      newPasswordRequired: () => {
        reject(new Error("New password required — set it in Cognito console first."));
      },
    });
  });
}

export function signOut(): void {
  const user = pool.getCurrentUser();
  if (user) user.signOut();
}
