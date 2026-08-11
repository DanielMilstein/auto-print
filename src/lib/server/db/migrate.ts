import type { Sql } from 'postgres';

// Bundled at build time so migrations work identically in dev and in the adapter-node build.
const files = import.meta.glob('./migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
	string,
	string
>;

export async function migrate(sql: Sql): Promise<void> {
	await sql`CREATE TABLE IF NOT EXISTS _migrations (
		name text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`;

	for (const [path, statements] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
		const name = path.split('/').pop()!;
		const applied = await sql`SELECT 1 FROM _migrations WHERE name = ${name}`;
		if (applied.length > 0) continue;
		await sql.begin(async (tx) => {
			await tx.unsafe(statements);
			await tx`INSERT INTO _migrations (name) VALUES (${name})`;
		});
		console.log(`[db] applied migration ${name}`);
	}
}
