export function readNullTerminated(data, offset) {
	let i = offset;
	while (data.readUInt8(i++));
	return data.subarray(offset, i);
}

export function subview(data, start, size = null) {
	size = size === null ? data.length - start : size;
	const r = data.subarray(start, start + size);
	if (r.length < size) {
		throw new Error(`Buffer is too small: ${r.length} < ${size}`);
	}
	return r;
}

export function bitCountU(i) {
	let n = 0;
	for (; i; i >>= 1) {
		n++;
	}
	return n;
}

export function bitCountS(i) {
	return (i < 0) ?
		(bitCountU(-i) + 1) :
		(bitCountU(i) + 1);
}

export function bitReader(data, start) {
	return (c, b) => {
		let r = 0;
		for (let i = 0; i < c; i++) {
			const bI = b + i;
			const bitI = bI % 8;
			const byteI = (bI - bitI) / 8;
			const v = (data.readUInt8(start + byteI) >> (7 - bitI)) & 1;
			r = (r << 1) | v;
		}
		return (r >>> 0);
	};
}

export function bitWriter(data, start) {
	return (v, c, b) => {
		for (let i = 0; i < c; i++) {
			const bI = b + i;
			const bitI = bI % 8;
			const byteI = (bI - bitI) / 8;
			let byteV = data.readUInt8(start + byteI);
			const flag = 1 << (7 - bitI);
			if ((v >> ((c - 1) - i)) & 1) {
				byteV |= flag;
			}
			else {
				byteV &= ~flag;
			}
			data.writeUInt8(byteV, start + byteI);
		}
	};
}

export function bitCountToBytes(count) {
	const over = count % 8;
	return ((count - over) / 8) + (over ? 1 : 0);
}

export class Data extends Object {
	constructor() {
		super();
	}

	get size() {
		throw new Error('Override in child class');
	}

	decoder(data) {
		throw new Error('Override in child class');
	}

	decode(data, offset = 0) {
		return this.decoder(data.subarray(offset));
	}

	encoder(data) {
		throw new Error('Override in child class');
	}

	encode(data = null, offset = 0) {
		const {size} = this;
		data = data ? subview(data, offset, size) : Buffer.alloc(size);
		this.encoder(data);
		return data;
	}
}
