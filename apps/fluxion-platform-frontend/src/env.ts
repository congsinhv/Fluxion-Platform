// Centralized Vite env access. Build fails loud if a required var is missing
// so we never silently ship a placeholder endpoint.
function required(name: string): string {
  const v = import.meta.env[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing env: ${name}. Copy .env.example to .env.`);
  }
  return v;
}

export const env = {
  region: required("VITE_AWS_REGION"),
  userPoolId: required("VITE_COGNITO_USER_POOL_ID"),
  userPoolClientId: required("VITE_COGNITO_USER_POOL_CLIENT_ID"),
  appsyncUrl: required("VITE_APPSYNC_URL"),
};
