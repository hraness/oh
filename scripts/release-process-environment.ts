const RUNTIME_NAMES = Object.freeze([
  "HOME", "LANG", "LC_ALL", "LC_CTYPE", "NODE_EXTRA_CA_CERTS", "PATH",
  "SSL_CERT_FILE", "TEMP", "TMP", "TMPDIR", "TZ",
] as const);

const TRUSTED_PUBLISHING_NAMES = Object.freeze([
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GITHUB_ACTION",
  "GITHUB_ACTIONS", "GITHUB_ACTOR", "GITHUB_ACTOR_ID", "GITHUB_API_URL",
  "GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH", "GITHUB_GRAPHQL_URL", "GITHUB_HEAD_REF",
  "GITHUB_JOB", "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_REF_PROTECTED",
  "GITHUB_REF_TYPE", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID",
  "GITHUB_REPOSITORY_OWNER", "GITHUB_REPOSITORY_OWNER_ID", "GITHUB_RUN_ATTEMPT",
  "GITHUB_RUN_ID", "GITHUB_RUN_NUMBER", "GITHUB_SERVER_URL", "GITHUB_SHA",
  "GITHUB_WORKFLOW", "GITHUB_WORKFLOW_REF", "GITHUB_WORKFLOW_SHA", "RUNNER_ARCH",
  "RUNNER_ENVIRONMENT", "RUNNER_NAME", "RUNNER_OS", "RUNNER_TEMP", "RUNNER_TOOL_CACHE",
] as const);

type ProcessEnvironment = Record<string, string | undefined>;

function copySelected(source: NodeJS.ProcessEnv, names: readonly string[], target: ProcessEnvironment): void {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) target[name] = value;
  }
}

function mergeExtra(target: ProcessEnvironment, extra: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(extra)) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || value.includes("\0")) {
      throw new Error("Release subprocess environment override is invalid.");
    }
    target[name] = value;
  }
}

export function publicReleaseEnvironment(
  extra: Readonly<Record<string, string>> = {},
  source: NodeJS.ProcessEnv = process.env,
): ProcessEnvironment {
  const environment: ProcessEnvironment = {};
  copySelected(source, RUNTIME_NAMES, environment);
  mergeExtra(environment, extra);
  return environment;
}

export function githubReleaseEnvironment(
  extra: Readonly<Record<string, string>> = {},
  source: NodeJS.ProcessEnv = process.env,
): ProcessEnvironment {
  const environment = publicReleaseEnvironment({}, source);
  const token = source.GH_TOKEN ?? source.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) throw new Error("GitHub release environment is missing its job token.");
  environment.GH_TOKEN = token;
  mergeExtra(environment, extra);
  return environment;
}

export function trustedPublishingEnvironment(
  extra: Readonly<Record<string, string>> = {},
  source: NodeJS.ProcessEnv = process.env,
): ProcessEnvironment {
  const environment = publicReleaseEnvironment({}, source);
  copySelected(source, TRUSTED_PUBLISHING_NAMES, environment);
  for (const name of [
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "GITHUB_REF",
    "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_ID",
    "GITHUB_SERVER_URL", "GITHUB_SHA", "GITHUB_WORKFLOW_REF", "RUNNER_ENVIRONMENT",
  ] as const) {
    if (environment[name] === undefined) throw new Error(`npm trusted publishing environment is missing ${name}.`);
  }
  mergeExtra(environment, extra);
  return environment;
}
