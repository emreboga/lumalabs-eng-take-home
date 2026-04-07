import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      slack_user_id TEXT PRIMARY KEY,
      token_hash    TEXT NOT NULL UNIQUE,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id            BIGSERIAL PRIMARY KEY,
      slack_user_id TEXT NOT NULL,
      issue_number  INTEGER,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      plan_text     TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('[db] schema ready');
}

// Agents

export async function registerAgent(slackUserId: string, tokenHash: string): Promise<void> {
  await sql`
    INSERT INTO agents (slack_user_id, token_hash)
    VALUES (${slackUserId}, ${tokenHash})
    ON CONFLICT (slack_user_id) DO UPDATE
      SET token_hash = EXCLUDED.token_hash,
          is_active  = TRUE
  `;
}

export async function resolveAgent(tokenHash: string): Promise<string | null> {
  const rows = await sql<{ slack_user_id: string }[]>`
    SELECT slack_user_id FROM agents
    WHERE token_hash = ${tokenHash} AND is_active = TRUE
    LIMIT 1
  `;
  return rows[0]?.slack_user_id ?? null;
}

// Tasks

export async function createTask(
  slackUserId: string,
  type: string,
  issueNumber?: number,
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO tasks (slack_user_id, type, issue_number)
    VALUES (${slackUserId}, ${type}, ${issueNumber ?? null})
    RETURNING id::int
  `;
  return rows[0].id;
}

export async function updateTask(
  id: number,
  fields: { status?: string; planText?: string },
): Promise<void> {
  await sql`
    UPDATE tasks
    SET status     = COALESCE(${fields.status ?? null}, status),
        plan_text  = COALESCE(${fields.planText ?? null}, plan_text),
        updated_at = NOW()
    WHERE id = ${id}
  `;
}

export default sql;
