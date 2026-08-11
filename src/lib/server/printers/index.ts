import type { PrinterAdapter } from './adapter';
import { PrusaLinkAdapter } from './prusalink';
import type { Printer } from './repo';

type AdapterFactory = (printer: Printer) => PrinterAdapter;

/** Open for extension: register a new brand here without touching call sites. */
const factories: Record<string, AdapterFactory> = {
	prusa: (p) => new PrusaLinkAdapter(p.host, p.api_key)
};

export function adapterFor(printer: Printer): PrinterAdapter {
	const factory = factories[printer.brand];
	if (!factory) throw new Error(`No adapter registered for printer brand "${printer.brand}"`);
	return factory(printer);
}

export const supportedBrands = Object.keys(factories);
