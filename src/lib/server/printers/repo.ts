import { sql } from '../db';

export interface Printer {
	id: number;
	name: string;
	brand: string;
	host: string;
	api_key: string;
	vision_base_url: string;
	stop_on_failure: boolean;
	robot_gateway_url: string;
	robot_task: string;
	robot_params_json: Record<string, string>;
	timelapse_enabled: boolean;
	timelapse_interval_sec: number;
	timelapse_fps: number;
	enabled: boolean;
	created_at: Date;
}

export type PrinterInput = Omit<Printer, 'id' | 'created_at'>;

export async function listPrinters(): Promise<Printer[]> {
	return (await sql`SELECT * FROM printers ORDER BY id`) as unknown as Printer[];
}

export async function getPrinter(id: number): Promise<Printer | null> {
	const rows = await sql`SELECT * FROM printers WHERE id = ${id}`;
	return (rows[0] as unknown as Printer) ?? null;
}

export async function createPrinter(input: PrinterInput): Promise<number> {
	const rows = await sql`INSERT INTO printers ${sql({
		...input,
		robot_params_json: sql.json(input.robot_params_json)
	})} RETURNING id`;
	return rows[0].id as number;
}

export async function updatePrinter(id: number, input: PrinterInput): Promise<void> {
	await sql`UPDATE printers SET ${sql({
		...input,
		robot_params_json: sql.json(input.robot_params_json)
	})} WHERE id = ${id}`;
}

export async function deletePrinter(id: number): Promise<void> {
	await sql`DELETE FROM printers WHERE id = ${id}`;
}
