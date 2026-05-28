import type { CodegenConfig } from "@graphql-codegen/cli";

// Generate types + typed-document-node from the local SDL. The deployed
// AppSync API is the same schema, but introspecting it requires a JWT so
// the file path is the cheaper source of truth.
const config: CodegenConfig = {
  schema: "../../infra/schema/appsync.graphql",
  documents: ["src/**/*.graphql"],
  generates: {
    "src/graphql/generated/": {
      preset: "client",
      config: {
        scalars: {
          AWSDateTime: "string",
          AWSJSON: "string",
        },
      },
    },
  },
  ignoreNoDocuments: true,
};
export default config;
