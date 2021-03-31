import {
	readNullTerminated,
	subview,
	bitReader,
	bitCountToBytes
} from './data.mjs';
import {
	Swf,
	DoAction,
	PlaceObject2,
	DefineButton2,
	DefineSprite
} from './swf.mjs';
import {
	ActionConstantPool,
	ActionWaitForFrame,
	ActionWaitForFrame2,
	ActionDefineFunction2,
	ActionWith,
	ActionJump,
	ActionDefineFunction,
	ActionIf,
	ASVM1
} from './asvm1.mjs';

function actionsSplice(code, start, size, insert = null) {
	const amount = (insert ? insert.length : 0) - size;
	const end = start + size;
	if (!amount) {
		// No change in size, just replace.
		return Buffer.concat([
			subview(code, 0, start),
			...(insert ? [insert] : []),
			subview(code, end)
		]);
	}
	const codeA = Buffer.concat([subview(code, 0, start)]);
	const codeB = Buffer.concat([subview(code, end)]);
	const vmA = new ASVM1(codeA);
	const vmB = new ASVM1(codeB);

	// Fix actions that point past first chunk.
	while (vmA.pc < codeA.length) {
		const {opcode, data} = vmA.readAction();
		switch (opcode) {
			case ActionJump:
			case ActionIf: {
				const offset = data.readInt16LE(0);
				if ((vmA.pc + offset) > codeA.length) {
					data.writeInt16LE(offset + amount, 0);
				}
				break;
			}
			case ActionDefineFunction:
			case ActionDefineFunction2:
			case ActionWith: {
				const o = data.length - 2;
				const offset = data.readUInt16LE(o);
				if ((vmA.pc + offset) > codeA.length) {
					data.writeUInt16LE(offset + amount, o);
				}
				break;
			}
			case ActionWaitForFrame:
			case ActionWaitForFrame2: {
				const o = data.length - 1;
				const offset = data.readUInt8(o);
				if ((vmA.pc + offset) > codeA.length) {
					data.writeUInt8(offset + amount, o);
				}
				break;
			}
		}
	}

	// Fix actions that point before second chunk.
	while (vmB.pc < codeB.length) {
		const {opcode, data} = vmB.readAction();
		switch (opcode) {
			case ActionJump:
			case ActionIf: {
				const offset = data.readInt16LE(0);
				if ((vmB.pc + offset) < 0) {
					data.writeInt16LE(offset - amount, 0);
				}
				break;
			}
		}
	}

	return Buffer.concat([
		codeA,
		...(insert ? [insert] : []),
		codeB
	]);
}

function deobfuActions(data, before, end, entry) {
	const vm = new ASVM1(data, entry);

	// Step through code until we jump back into unknown tag.
	// Remember last constant pool that we might find.
	let constantPool = null;
	let lastPc = 0;
	do {
		lastPc = vm.pc;
		if (vm.nextOpcode() === ActionConstantPool) {
			constantPool = subview(data, vm.pc, vm.nextAction().size);
		}
		if (!vm.step()) {
			throw new Error('Code ended while tracing entry point');
		}
	}
	while (vm.pc >= before);

	// Only expecting to trace over jump actions now.
	vm.actions = vm.actions.map((f, o) => o === ActionJump ? f : null);

	// Trace over jump pairs until we reach the start.
	// If multiples codes or large enough, it may take more than one.
	const jumpPairs = [];
	do {
		jumpPairs.push(vm.pc - 5);
		if (!vm.step()) {
			throw new Error('Code ended while tracing start jumps');
		}
	} while (vm.nextOpcode() === ActionJump);
	jumpPairs.sort((a, b) => a - b);
	const jumpPairsSet = new Set(jumpPairs);

	// Should now point at start of the body.
	const bodyStart = vm.pc;

	// Locate packed code end, when a jump pair leads to another or back out.
	let bodyEnd = null;
	for (const jumpPair of jumpPairs) {
		vm.pc = jumpPair;
		if (!vm.step()) {
			throw new Error('Code ended while tracing end jumps');
		}
		if (vm.pc >= before || jumpPairsSet.has(vm.pc)) {
			bodyEnd = jumpPair;
			break;
		}
	}
	if (bodyEnd === null) {
		throw new Error('Failed to locate packed code end');
	}

	// Skip after body and ensure it finishes by jumping to the end.
	vm.pc = bodyEnd;
	while (vm.step());
	if (vm.pc !== end) {
		throw new Error('Unexpected code end location');
	}

	// Assemble the code pieces.
	const parts = constantPool ? [constantPool] : [];

	// Extract the real packed code body.
	let body = data.subarray(bodyStart, bodyEnd);

	// Remove jump pairs in the body.
	while (jumpPairs.length) {
		const jumpPair = jumpPairs.pop();
		if (jumpPair < bodyEnd) {
			body = actionsSplice(body, jumpPair - bodyStart, 10);
		}
	}
	parts.push(body);

	// Add the end tag, and merge them together.
	parts.push(Buffer.alloc(1));
	return Buffer.concat(parts);
}

const fixes = (new Array(0xFF)).fill(null);
fixes[DoAction.CODE] = (unk, tag) => {
	const unkD = unk.encode();
	const tagD = tag.encode();
	const data = Buffer.concat([unkD, tagD]);

	const code = deobfuActions(
		data,
		unkD.length,
		data.length,
		unkD.length + tag.headerSize
	);

	tag.data = code;
	return tag;
};
fixes[PlaceObject2.CODE] = (unk, tag, swfv) => {
	const unkD = unk.encode();
	const tagD = tag.encode();
	const data = Buffer.concat([unkD, tagD]);
	const base = unkD.length + tag.headerSize;

	let i = 0;
	const flags = tag.data.readUInt8(i++);
	i += 2;
	// PlaceFlagHasCharacter
	if ((flags >> 1) & 1) {
		i += 2;
	}
	// PlaceFlagHasMatrix
	if ((flags >> 2) & 1) {
		let b = 0;
		const bR = bitReader(tag.data, i);
		for (const optional of [true, true, false]) {
			if (!optional || bR(1, b++)) {
				b += 5 + (bR(5, b) * 2);
			}
		}
		i += bitCountToBytes(b);
	}
	// PlaceFlagHasColorTransform
	if ((flags >> 3) & 1) {
		const bR = bitReader(tag.data, i);
		let b = 0;
		const hasAddTerms = bR(1, b++);
		const hasMultTerms = bR(1, b++);
		const nBits = bR(4, b);
		b += 4;
		b += nBits * 4 * hasMultTerms;
		b += nBits * 4 * hasAddTerms;
		i += bitCountToBytes(b);
	}
	// PlaceFlagHasRatio
	if ((flags >> 4) & 1) {
		i += 2;
	}
	// PlaceFlagHasName
	if ((flags >> 5) & 1) {
		i += readNullTerminated(tag.data, i).length;
	}
	// PlaceFlagHasClipDepth
	if ((flags >> 6) & 1) {
		i += 2;
	}
	// PlaceFlagHasClipActions
	if (!((flags >> 7) & 1)) {
		throw new Error('Expected actions');
	}
	// Reserved
	i += 2;
	// AllEventFlags
	i += swfv >= 6 ? 4 : 2;

	const parts = [subview(tag.data, 0, i)];
	for (;;) {
		const eventFlags = swfv >= 6 ?
			tag.data.readUInt32LE(i) : tag.data.readUInt16LE(i);
		parts.push(subview(tag.data, i, swfv >= 6 ? 4 : 2));
		i += swfv >= 6 ? 4 : 2;
		if (!eventFlags) {
			if (i < tag.data.length) {
				throw new Error(`Extra data: ${tag.data.length - i}`);
			}
			break;
		}
		const actionRecordSize = tag.data.readUInt32LE(i);
		i += 4;
		const end = base + i + actionRecordSize;
		let newSize = 0;
		const newSizeData = Buffer.alloc(4);
		parts.push(newSizeData);

		// If ClipEventKeyPress
		if ((eventFlags >> 22) & 1) {
			parts.push(subview(tag.data, i++, 1));
			newSize++;
		}

		const code = deobfuActions(
			data,
			unkD.length,
			end,
			base + i
		);
		newSize += code.length;
		parts.push(code);
		newSizeData.writeUInt32LE(newSize, 0);

		i += actionRecordSize;
	}

	tag.data = Buffer.concat(parts);
	return tag;
};
fixes[DefineButton2.CODE] = (unk, tag) => {
	const unkD = unk.encode();
	const tagD = tag.encode();
	const data = Buffer.concat([unkD, tagD]);
	const base = unkD.length + tag.headerSize;

	let i = 3;
	const actionOffset = tag.data.readUInt16LE(i);
	i += actionOffset;
	const parts = [subview(tag.data, 0, i)];
	while (i < tag.data.length) {
		const condActionSize = tag.data.readUInt16LE(i);
		const flags = tag.data.readUInt16LE(i + 2);
		const size = condActionSize ?
			condActionSize :
			(tag.data.length - i);

		const code = deobfuActions(
			data,
			unkD.length,
			base + i + size,
			base + i + 4
		);
		const head = Buffer.alloc(4);
		head.writeUInt16LE(condActionSize ? code.length + 4 : 0, 0);
		head.writeUInt16LE(flags, 2);
		parts.push(head, code);

		if (condActionSize) {
			i += condActionSize;
			continue;
		}
		break;
	}

	tag.data = Buffer.concat(parts);
	return tag;
};

function fixTags(tags, swfv) {
	for (let i = 0; i < tags.length; i++) {
		const tag = tags[i];
		switch (tag.code) {
			// Extra unknown tag added to header.
			case 255: {
				tags.splice(i--, 1);
				break;
			}
			// Contains code to unpack for the next tag.
			case 253: {
				const nextTag = tags[i + 1];
				if (!nextTag) {
					throw new Error(`No tag following unknown: ${tag.code}`);
				}
				const fixer = fixes[nextTag.code];
				if (!fixer) {
					throw new Error(`No fix for tag: ${nextTag.code}`);
				}
				const fixed = fixer(tag, nextTag, swfv);
				if (!fixed) {
					throw new Error(`Failed to fix tag: ${nextTag.code}`);
				}
				tags.splice(i, 2, fixed);
				break;
			}
			// Child tags.
			case DefineSprite.CODE: {
				const sprite = new DefineSprite();
				sprite.decode(tag.data);
				fixTags(sprite.tags, swfv);
				tag.data = sprite.encode();
				break;
			}
		}
	}
}

export function unpack(data) {
	const swf = new Swf();
	swf.decode(data);
	fixTags(swf.tags, swf.version);
	return swf.encode();
}
