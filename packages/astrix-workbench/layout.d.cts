export type WorkbenchLayout = {
  repositoryRoot: string;
  sharedRoot: string;
  webRoot: string;
  desktopRoot: string;
  recoveryRoot: string;
  publicRoot: string;
  legacyRoot: string;
  version: string;
};
export function getLayout(options?: {repositoryRoot?: string; recoveryRoot?: string; publicRoot?: string}): WorkbenchLayout;
export function getStatePaths(options?: {
  surface?: 'web' | 'desktop';
  profile?: string;
  packaged?: boolean;
  userData?: string;
  layout?: WorkbenchLayout;
}): {base: string; dataDir: string; profileDir: string; workspaceRoot: string; diagnosticsDir: string};
