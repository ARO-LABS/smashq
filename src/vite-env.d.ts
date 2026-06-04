/// <reference types="vite/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare const __BUILD_DATE__: string;
declare const __GIT_HASH__: string;
