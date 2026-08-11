import type { PageServerLoad } from './$types';
import { listPrinters } from '$lib/server/printers/repo';

export const load: PageServerLoad = async () => {
	return { printers: await listPrinters() };
};
