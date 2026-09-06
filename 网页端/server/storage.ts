import { join, resolve } from 'node:path'

const DATA_DIRECTORY_ENVIRONMENT_VARIABLE = 'DESIGN_STUDIO_DATA_DIR'

/**
 * Returns the writable directory used by local Design Studio services.
 *
 * The desktop host sets DESIGN_STUDIO_DATA_DIR to Electron's userData path.
 * Browser-only development keeps the existing repository-local directory.
 */
export function resolveDesignStudioDataDirectory() {
  const configuredDirectory =
    process.env[DATA_DIRECTORY_ENVIRONMENT_VARIABLE]?.trim()

  return configuredDirectory
    ? resolve(configuredDirectory)
    : join(process.cwd(), '.design-studio')
}

export function resolveDesignStudioDataPath(fileName: string) {
  if (!fileName || fileName.includes('\0')) {
    throw new Error('Invalid Design Studio data file name.')
  }

  return join(resolveDesignStudioDataDirectory(), fileName)
}
