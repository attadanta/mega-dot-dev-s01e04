/** Status of a single job line in the log. */
export type JobStatus = 'ok' | 'retry' | 'fail';

/** One job's summary for a night. */
export type DigestRow = {
  job: string;
  owner: string | null;    // owner on the job's last line; null when the log says null
  runs: number;            // lines for this job
  retries: number;         // lines with status 'retry'
  lastStatus: JobStatus;   // status on the job's last line
  lastError: string | null; // most recent error seen for this job in the night, or null
  firstAt: string;         // `at` of the job's first line, exactly as logged, offset kept
  lastAt: string;          // `at` of the job's last line, exactly as logged, offset kept
};

/** Count of valid log lines in a night, by status (a job retried three times adds 3 to retry). */
export type NightCounts = { ok: number; retry: number; fail: number };

/** Digest of all jobs for one night. */
export type NightDigest = {
  night: string;      // YYYY-MM-DD
  rows: DigestRow[];  // sorted by job name, plain code-unit order
  badLines: number;   // lines that did not parse or did not have the expected shape
  counts: NightCounts; // valid lines only; bad lines are not counted here
};

/** Reads a night's log; null when the night has no file or the night string is not YYYY-MM-DD. */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
