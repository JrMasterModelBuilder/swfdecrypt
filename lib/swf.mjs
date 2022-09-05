import {
	Data,
	bitCountS,
	bitReader,
	bitWriter,
	bitCountToBytes
} from './data.mjs';

export class Fixed8 extends Data {
	constructor() {
		super();

		this.numerator = 0;
		this.denominator = 0;
	}

	get size() {
		return 2;
	}

	decoder(data) {
		this.denominator = data.readUInt8(0);
		this.numerator = data.readUInt8(1);
		return 2;
	}

	encoder(data) {
		data.writeUInt8(this.denominator, 0);
		data.writeUInt8(this.numerator, 1);
	}
}

export class Rect extends Data {
	constructor() {
		super();

		this.xMin = 0;
		this.xMax = 0;
		this.yMin = 0;
		this.yMax = 0;
		this.forceNBits = 0;
	}

	get nBits() {
		return Math.max(this.forceNBits, Math.max(
			bitCountS(this.xMin),
			bitCountS(this.xMax),
			bitCountS(this.yMin),
			bitCountS(this.yMax)
		));
	}

	get size() {
		return bitCountToBytes(5 + (this.nBits * 4));
	}

	decoder(data) {
		const bR = bitReader(data, 0);
		let b = 0;
		const nBits = bR(5, b);
		b += 5;
		const values = [];
		for (let i = 0; i < 4; i++) {
			values.push(bR(nBits, b, true));
			b += nBits;
		}
		this.forceNBits = nBits;
		[this.xMin, this.xMax, this.yMin, this.yMax] = values;
		return bitCountToBytes(b);
	}

	encoder(data) {
		const {nBits} = this;
		const bW = bitWriter(data, 0);
		let b = 0;
		bW(nBits, 5, b);
		b += 5;
		for (const value of [this.xMin, this.xMax, this.yMin, this.yMax]) {
			bW(value, nBits, b);
			b += nBits;
		}
		const over = b % 8;
		if (over) {
			bW(0, 8 - over, b);
		}
	}
}

export class Tag extends Data {
	constructor() {
		super();

		this.code = 0;
		this.data = Buffer.alloc(0);
		this.forceLong = false;
	}

	get long() {
		return this.forceLong || this.data.length >= 0b111111;
	}

	get headerSize() {
		return 2 + (this.long ? 4 : 0);
	}

	get size() {
		return this.headerSize + this.data.length;
	}

	decoder(data) {
		let i = 0;
		const head = data.readUInt16LE(i);
		const code = head >> 6;
		let len = head & 0b111111;
		i += 2;
		let forceLong = false;
		if (len === 0b111111) {
			len = data.readUInt32LE(i);
			i += 4;
			forceLong = len < 0b111111;
		}
		const d = data.slice(i, i + len);
		this.code = code;
		this.data = d;
		this.forceLong = forceLong;
		return i + len;
	}

	encoder(data) {
		let i = 0;
		const {code, data: d, long} = this;
		const head = (code << 6) | (long ? 0b111111 : d.length);
		data.writeUInt16LE(head, i);
		i += 2;
		if (long) {
			data.writeUInt32LE(d.length, i);
			i += 4;
		}
		d.copy(data, i);
	}
}

export class DoAction extends Data {
	static CODE = 12;

	constructor() {
		super();
	}
}

export class PlaceObject2 extends Data {
	static CODE = 26;

	constructor() {
		super();
	}
}

export class DefineButton2 extends Data {
	static CODE = 34;

	constructor() {
		super();
	}
}

export class DefineSprite extends Data {
	static CODE = 39;

	constructor() {
		super();

		this.spriteId = 0;
		this.frameCount = 0;
		this.tags = [];
	}

	get size() {
		return this.tags.reduce((v, t) => t.size + v, 2 + 2);
	}

	decoder(data) {
		let i = 0;
		const spriteId = data.readUInt16LE(i);
		i += 2;

		const frameCount = data.readUInt16LE(i);
		i += 2;

		const tags = [];
		while (i < data.length) {
			const tag = new Tag();
			i += tag.decode(data, i);
			tags.push(tag);
		}

		this.spriteId = spriteId;
		this.frameCount = frameCount;
		this.tags = tags;

		return i;
	}

	encoder(data) {
		let i = 0;
		data.writeUInt16LE(this.spriteId, i);
		i += 2;

		data.writeUInt16LE(this.frameCount, i);
		i += 2;

		for (const tag of this.tags) {
			i += tag.encode(data, i).length;
		}
	}
}

export class DoInitAction extends Data {
	static CODE = 59;

	constructor() {
		super();
	}
}

export class Swf extends Data {
	constructor() {
		super();

		this.version = 0;
		this.frameSize = new Rect();
		this.frameRate = new Fixed8();
		this.frameCount = 0;
		this.tags = [];
	}

	get size() {
		return this.tags.reduce(
			(v, t) => t.size + v,
			3 + 1 + 4 + this.frameSize.size + this.frameRate.size + 2
		);
	}

	decoder(data) {
		let i = 0;
		const sig = data.toString('ascii', i, 3);
		i += 3;
		if (sig !== 'FWS') {
			throw new Error(
				`Unexpected SWF signature: ${JSON.stringify(sig)}`
			);
		}

		const version = data.readUInt8(i++);

		const size = data.readUInt32LE(i);
		i += 4;
		if (size > data.length) {
			throw new Error(`Unexpected SWF size: ${size} > ${data.length}`);
		}
		data = data.subarray(0, size);

		const rect = new Rect();
		i += rect.decode(data, i);

		const frameRate = new Fixed8();
		i += frameRate.decode(data, i);

		const frameCount = data.readUInt16LE(i);
		i += 2;

		const tags = [];
		while (i < size) {
			const tag = new Tag();
			i += tag.decode(data, i);
			tags.push(tag);
		}

		this.version = version;
		this.frameSize = rect;
		this.frameRate = frameRate;
		this.frameCount = frameCount;
		this.tags = tags;

		return size;
	}

	encoder(data) {
		let i = 0;
		data.write('FWS', i, 'ascii');
		i += 3;

		data.writeUInt8(this.version, i++);

		data.writeUInt32LE(this.size, i);
		i += 4;

		i += this.frameSize.encode(data, i).length;

		i += this.frameRate.encode(data, i).length;

		data.writeUInt16LE(this.frameCount, i);
		i += 2;

		for (const tag of this.tags) {
			i += tag.encode(data, i).length;
		}
	}
}
