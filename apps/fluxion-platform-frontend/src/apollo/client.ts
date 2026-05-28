import { ApolloClient, InMemoryCache, HttpLink, from, split } from "@apollo/client";
import { getMainDefinition } from "@apollo/client/utilities";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { createAuthLink, AUTH_TYPE } from "aws-appsync-auth-link";
import { createSubscriptionHandshakeLink } from "aws-appsync-subscription-link";
import { env } from "@/env";
import { loadJwt, clearJwt } from "@/auth/jwt-store";

const httpLink = new HttpLink({ uri: env.appsyncUrl });

// Cognito JWT in localStorage. XSS tradeoff explicitly accepted per
// phase-04 Security Considerations (Validation Session 1).
const authLink = setContext((_, { headers }) => {
  const token = loadJwt();
  return {
    headers: {
      ...headers,
      ...(token ? { Authorization: token } : {}),
    },
  };
});

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (networkError && "statusCode" in networkError && networkError.statusCode === 401) {
    clearJwt();
    window.location.assign("/login");
  }
  if (graphQLErrors) {
    for (const err of graphQLErrors) {
      // eslint-disable-next-line no-console
      console.warn("[gql]", err.message, err.path);
    }
  }
});

// Real-time push: GraphQL subscriptions ride a WebSocket to the AppSync
// realtime endpoint, authenticated with the same Cognito JWT. Queries and
// mutations keep the existing HTTP chain (error + auth links). `split` routes
// by operation type so HTTP behavior (401 redirect, JWT header) is unchanged.
const awsLinkConfig = {
  url: env.appsyncUrl,
  region: env.region,
  auth: {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS as const,
    jwtToken: () => loadJwt() ?? "",
  },
};
// Note: this WS chain has no errorLink, so a 401/expired JWT on the handshake
// does not itself redirect to /login — it relies on the concurrent HTTP query
// hitting the 401 and triggering the redirect there. jwtToken is re-read on
// reconnect, so the subscription self-heals after re-auth.
const subscriptionLink = from([
  createAuthLink(awsLinkConfig),
  createSubscriptionHandshakeLink(awsLinkConfig, httpLink),
]);

const splitLink = split(
  (operation) => {
    const def = getMainDefinition(operation.query);
    return def.kind === "OperationDefinition" && def.operation === "subscription";
  },
  subscriptionLink,
  from([errorLink, authLink, httpLink]),
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          listDevices: { keyArgs: ["serviceType", "stateType", "search"] },
          listMilestones: { keyArgs: ["deviceId"] },
          listTacs: { keyArgs: ["search"] },
          listDeviceUploads: { keyArgs: ["status"] },
        },
      },
    },
  }),
  defaultOptions: {
    // cache-and-network on every fire: returns cache instantly (no flicker)
    // then refreshes from the server. Critically, we do NOT set
    // `nextFetchPolicy: 'cache-first'` — that would short-circuit pollInterval
    // and silently kill the 10s refresh after the first response.
    watchQuery: { fetchPolicy: "cache-and-network", notifyOnNetworkStatusChange: false },
  },
});
