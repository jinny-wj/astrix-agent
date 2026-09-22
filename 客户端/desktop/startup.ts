/** Retry only preparation; never register IPC handlers or create workspaces twice. */
export async function prepareStartup(
  prepare: () => Promise<void>,
  retry: (error: unknown) => Promise<boolean>,
  cancelled: () => boolean,
): Promise<boolean> {
  while (!cancelled()) {
    try {
      await prepare()
      return !cancelled()
    } catch (error) {
      if (cancelled() || !(await retry(error))) return false
    }
  }
  return false
}
