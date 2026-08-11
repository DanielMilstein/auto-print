import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import { migrate } from './migrate';

const globalForDb = globalThis as unknown as { __autoprintSql?: postgres.Sql };

export const sql: postgres.Sql =
	globalForDb.__autoprintSql ??
	postgres(env.DATABASE_URL ?? 'postgres://autoprint:autoprint@localhost:5434/autoprint', {
		onnotice: () => {}
	});
globalForDb.__autoprintSql = sql;

let migrated: Promise<void> | undefined;

/** Ensures migrations ran exactly once per process before the first query. */
export function ready(): Promise<void> {
	migrated ??= migrate(sql);
	return migrated;
}
