/* eslint-disable @typescript-eslint/no-require-imports -- CJS jest setup file */
// Clears ambient environment state before running tests to ensure hermeticity.
//
// MUGIL_IDE_* overrides would otherwise change behavior per machine. Provider
// API keys matter too: `createEngine`/`loadConfig` read them, so a developer
// with OPENROUTER_API_KEY exported got live network calls in "mock mode" tests
// (and different results on CI). And the user env file must not be loaded,
// or the same keys leak back in via `loadUserEnvIntoProcess`.
const PROVIDER_KEY_PATTERN = new RegExp(
  '^(?:OPENROUTER|OPENAI|ANTHROPIC|VERCEL|AI_GATEWAY|TOGETHER|CLOUDFLARE|EXA|GROQ|MISTRAL|DEEPSEEK|XAI)_API_KEY$',
);
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MUGIL_IDE_') || PROVIDER_KEY_PATTERN.test(key)) {
    delete process.env[key];
  }
}
// Point the user env layer at a path that cannot exist, so a developer's real
// ~/.config/mugil-ide/.env never reaches the tests. This is an override, so it
// must be set after the sweep above.
process.env.MUGIL_IDE_ENV_FILE = require('node:path').join(
  require('node:os').tmpdir(),
  'mugil-ide-test-env-does-not-exist',
);
// Same reasoning for the global skills tier: skill-listing assertions must not
// depend on the developer's ~/.config/mugil-ide/skills.
process.env.MUGIL_IDE_SKILLS_DIR = require('node:path').join(
  require('node:os').tmpdir(),
  'mugil-ide-test-skills-do-not-exist',
);
