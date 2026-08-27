export function isOrphanedWorld(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/i.test(error.message);
}

export function runOrphanSafe(run: () => void, onDead: () => void): void {
  try {
    run();
  } catch (error) {
    if (isOrphanedWorld(error)) {
      onDead();
      return;
    }
    throw error;
  }
}
