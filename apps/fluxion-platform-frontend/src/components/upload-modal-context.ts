import { createContext, useContext } from "react";

// Lets any screen (sidebar, devices list, upload history) open the single
// shared Upload-IMEI modal without prop-drilling or its own page route.
export interface UploadModalApi {
  open: () => void;
}

export const UploadModalContext = createContext<UploadModalApi>({ open: () => {} });

export function useUploadModal(): UploadModalApi {
  return useContext(UploadModalContext);
}
