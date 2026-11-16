// Where the page's API calls go, fixed at build time:
//   VITE_API_URL unset  -> the Hono app in the page, behind MSW, over the wasm emulator
//   VITE_API_URL set    -> the same app deployed as a Lambda Web Function (../infra), with
//                          Cognito sign-in (VITE_COGNITO_*)
// Nothing else in the page changes: the same requests go to a different place.
export const API_URL = import.meta.env.VITE_API_URL || '';
export const TARGET = API_URL ? 'aws' : 'emulator';
