export type ToolErrorCode =
  | "usage"
  | "unexpected"
  | "scope_refused"
  | "no_client"
  | "bad_client"
  | "reauth_needed"
  | "bad_email"
  | "account_required"
  | "bad_calendar"
  | "read_only"
  | "google_error"
  | "bad_args"
  | "timeout"
  | "auth_timeout"
  | "auth_failed"
  | "token_error"
  | "write_refused"
  | "not_found"
  | "changed_meanwhile"
  | "already_exists"
  | "bad_event"
  | "calendar_not_allowed"
  | "account_not_allowed"
  | "nothing_to_change"
  | "event_cancelled"
  | "recurring_event"
  | "has_guests"
  | "not_a_calma_event"
  | "bad_policy"
  | "write_not_configured";

export type Env = NodeJS.ProcessEnv;

/** A token file this tool writes. Callers may omit fields the command does not have yet. */
export type TokenInput = {
  scope: unknown;
  account?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  saved_at?: unknown;
};

/**
 * Wider than `typeof fetch` so test fakes typecheck. `headers` and `signal` are required because every call this
 * tool makes goes through fetchWithTimeout, which always sends both. `body` stays loose: token calls send
 * URLSearchParams, calendar calls send a JSON string, and fakes read whichever they were given.
 */
export type FetchInit = {
  method?: string;
  headers: Record<string, string>;
  body?: any;
  signal: AbortSignal;
};

export type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type FetchLike = (input: string | URL, init: FetchInit) => Promise<FetchResponse>;

export type OpenLike = (url: string) => boolean | Promise<boolean>;

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options?: { stdio?: "ignore" | "pipe" | "inherit"; detached?: boolean; shell?: boolean },
) => {
  once(event: string, listener: (...args: any[]) => void): unknown;
  unref(): void;
};

/** What commands accept injected. Extra fields are ignored by the function that does not use them. */
export type IoDeps = {
  fetchFn?: FetchLike;
  env?: Env;
  now?: () => number;
  emit?: (value: unknown) => void;
  open?: OpenLike | null;
  yes?: boolean;
  timeoutMs?: number;
  calendar?: string;
  from?: string;
  to?: string;
};

export type WritePolicy = { accounts: string[]; calendars: string[] };

export type WriteOp = "create" | "update" | "delete";

export type EventInput = {
  title?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  description?: unknown;
  location?: unknown;
  free?: unknown;
  busy?: unknown;
  private?: unknown;
  public?: unknown;
  props?: object;
  actor?: unknown;
  key?: unknown;
  account?: unknown;
  calendar?: unknown;
  id?: unknown;
  anyEvent?: unknown;
};
