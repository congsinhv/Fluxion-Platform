import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ApolloProvider } from "@apollo/client";
import App from "@/App";
import { apolloClient } from "@/apollo/client";
import { AuthProvider } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/Toast";
import "@/styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ApolloProvider client={apolloClient}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ApolloProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
