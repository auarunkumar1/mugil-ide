// Clears ambient MUGIL_IDE_* environment variables before running tests to ensure test hermeticity.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MUGIL_IDE_')) {
    delete process.env[key];
  }
}

