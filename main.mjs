#!/usr/bin/env node

import {
	readFile,
	writeFile
} from 'fs/promises';

import {unpack} from './lib/unpack.mjs';

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 2) {
		throw new Error('Args: in.swf out.swf');
	}
	const [inFile, outFile] = args;
	await writeFile(outFile, unpack(await readFile(inFile)));
}
main().catch(err => {
	process.exitCode = 1;
	console.error(err);
});
